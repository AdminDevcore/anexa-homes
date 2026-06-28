#!/usr/bin/env python3
"""Fetch NOAA MRMS MESH (daily-max hail) for the Dallas region, polygonize by
hail-size tier, and POST GeoJSON swaths to the Anexa ingest endpoint.

Data source: NOAA Open Data S3 bucket `noaa-mrms-pds` (anonymous, free), product
CONUS/MESH_Max_1440min_00.50 — the rolling 24-hour max hail size grid (units mm,
~1km, lon in 0..360 convention). Public domain; MRMS is experimental data.

Env vars:
  INGEST_URL    (required)  e.g. https://anexahomes.com/api/storm/swaths/ingest
  CRON_SECRET   (required)  Bearer token matching the app's CRON_SECRET
  DATE          (optional)  YYYYMMDD; defaults to yesterday UTC
  BBOX          (optional)  "minLon,minLat,maxLon,maxLat" (-180..180); default Dallas
  TIERS_IN      (optional)  comma hail-size tiers in inches; default "1,1.5,2,2.5,3"
"""
import os
import gzip
import tempfile
import datetime

import boto3
from botocore import UNSIGNED
from botocore.config import Config
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio import features
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, transform as shp_transform
import requests

BUCKET = "noaa-mrms-pds"
PREFIX = "CONUS/MESH_Max_1440min_00.50"
MM_PER_IN = 25.4

INGEST_URL = os.environ["INGEST_URL"]
CRON_SECRET = os.environ.get("CRON_SECRET", "")
BBOX = os.environ.get("BBOX", "-99.2,31.0,-94.4,34.6")  # minLon,minLat,maxLon,maxLat
TIERS_IN = sorted(float(x) for x in os.environ.get("TIERS_IN", "1,1.5,2,2.5,3").split(","))


def target_date() -> datetime.date:
    d = os.environ.get("DATE")
    if d:
        return datetime.datetime.strptime(d, "%Y%m%d").date()
    return datetime.datetime.utcnow().date() - datetime.timedelta(days=1)


def latest_key(s3, day: datetime.date):
    """Latest MESH_Max_1440min .grib2.gz for the given UTC day (~24h max)."""
    pfx = f"{PREFIX}/{day:%Y%m%d}/"
    keys = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=pfx):
        for o in page.get("Contents", []):
            if o["Key"].endswith(".grib2.gz"):
                keys.append(o["Key"])
    return sorted(keys)[-1] if keys else None


def _to_180(x, y, z=None):
    # MRMS lon is 0..360; shift back to -180..180 for GeoJSON.
    return (x - 360 if x > 180 else x, y)


def build_features(path: str):
    minlon, minlat, maxlon, maxlat = (float(x) for x in BBOX.split(","))

    feats = []
    with rasterio.open(path) as ds:
        b = ds.bounds
        # MRMS is natively 0..360 lon, but GDAL may present it as -180..180.
        # Detect from the dataset's own bounds rather than assuming.
        zero360 = b.right > 180
        print(f"grid bounds={b} crs={ds.crs} shape={ds.shape} zero360={zero360}")
        left = (minlon + 360 if minlon < 0 else minlon) if zero360 else minlon
        right = (maxlon + 360 if maxlon < 0 else maxlon) if zero360 else maxlon

        win = from_bounds(left, minlat, right, maxlat, ds.transform)
        data = ds.read(1, window=win).astype("float64")
        transform = ds.window_transform(win)
        # MESH missing/no-coverage flags are negative (e.g. -3, -999); clamp to 0.
        valid = np.isfinite(data) & (data > 0)
        print(f"win={win} data.shape={data.shape} max_mm={float(data[valid].max()) if valid.any() else 0.0:.1f}")
        data = np.where(valid, data, 0.0)

        for inch in TIERS_IN:
            mask = (data >= inch * MM_PER_IN).astype(np.uint8)
            print(f"tier {inch}in (>={inch * MM_PER_IN:.0f}mm): {int(mask.sum())} cells")
            if int(mask.sum()) == 0:
                continue
            geoms = []
            for geom, val in features.shapes(mask, mask=mask.astype(bool), transform=transform):
                if val == 1:
                    geoms.append(shp_transform(_to_180, shape(geom)))
            if not geoms:
                continue
            merged = unary_union(geoms).simplify(0.005, preserve_topology=True)
            feats.append({"hailMinIn": inch, "geometry": mapping(merged)})
    return feats


def post(day: datetime.date, feats):
    payload = {"date": f"{day:%Y-%m-%d}", "source": "mrms_mesh", "features": feats}
    print(f"POST {len(feats)} tier-features for {payload['date']} -> {INGEST_URL}")
    r = requests.post(
        INGEST_URL,
        json=payload,
        headers={"Authorization": f"Bearer {CRON_SECRET}"},
        timeout=60,
    )
    print("ingest:", r.status_code, r.text[:200])
    r.raise_for_status()


def main():
    day = target_date()
    s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED))
    key = latest_key(s3, day)
    if not key:
        print(f"No MESH file for {day}; posting empty.")
        post(day, [])
        return
    print("downloading", key)
    body = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
    raw = gzip.decompress(body)
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tf:
        tf.write(raw)
        path = tf.name
    feats = build_features(path)
    post(day, feats)


if __name__ == "__main__":
    main()
