import type { Snapshot, SnapshotBody, SnapshotDocument, SnapshotField, SnapshotPage } from "./pdf";

type TemplateFieldRow = {
  id: string;
  documentId: string | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  signerRole: string;
  label: string | null;
  valueToken: string | null;
  defaultValue: string | null;
};

type TemplateDocumentRow = {
  id: string;
  name: string;
  order: number;
  sourcePdfKey: string | null;
  pages: SnapshotPage[];
};

/**
 * Freeze a template — every PDF in it — into the snapshot a package carries.
 *
 * Two shapes come out, and they are deliberately compatible:
 *
 *   • `documents[]` is the bundle, in order, each with its own pages and the
 *     fields placed on it. This is what the signing screen scrolls through and
 *     what the merged PDF is assembled from.
 *
 *   • the TOP-LEVEL pages/body/sourcePdfKey mirror document 1, and the
 *     top-level `fields` are the flattened union across all documents.
 *
 * The flattening is not redundancy. Signer-role filtering, DocumentFieldValue
 * rows, and every already-sent package all key off `snapshot.fields`, so keeping
 * it whole means multi-document envelopes need no special case anywhere those
 * are read — field ids are unique within a template, so a flat lookup is
 * unambiguous.
 *
 * A template with no document rows (every template predating multi-PDF support)
 * produces exactly the snapshot it always did, with a single synthesised entry.
 */
export function buildSnapshotFromTemplate(input: {
  /** Used as the synthetic document id when the template has no document rows,
   *  so two single-PDF templates bundled together cannot collide on one id. */
  templateId: string;
  name: string;
  pages: SnapshotPage[];
  body: SnapshotBody[];
  sourcePdfKey: string | null;
  documents: TemplateDocumentRow[];
  fields: TemplateFieldRow[];
}): Snapshot {
  const toField = (f: TemplateFieldRow): SnapshotField => ({
    id: f.id,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    type: f.type as SnapshotField["type"],
    signerRole: f.signerRole,
    label: f.label,
    valueToken: f.valueToken,
    defaultValue: f.defaultValue,
  });

  const rows = input.documents.length
    ? [...input.documents].sort((a, b) => a.order - b.order)
    : [
        {
          id: input.templateId,
          name: input.name || "Document",
          order: 1,
          sourcePdfKey: input.sourcePdfKey,
          pages: input.pages,
        },
      ];

  const single = rows.length === 1;
  const known = new Set(rows.map((r) => r.id));

  /**
   * With one document, a field's documentId is irrelevant — everything is on it,
   * which is what carries a legacy template's NULL-documentId fields through
   * unchanged.
   *
   * With several, an unassigned or dangling documentId lands on document 1
   * rather than being dropped. Dropping is the worse failure by a wide margin:
   * a contract would send looking complete, with nowhere to sign.
   */
  const belongsTo = (f: TemplateFieldRow, docId: string, isFirst: boolean) => {
    if (single) return true;
    if (f.documentId && known.has(f.documentId)) return f.documentId === docId;
    return isFirst;
  };

  const documents: SnapshotDocument[] = rows.map((d, i) => ({
    id: d.id,
    name: d.name,
    order: d.order,
    sourcePdfKey: d.sourcePdfKey ?? null,
    pages: d.pages ?? [],
    // Generated body blocks only ever belonged to the template's own page model,
    // which is document 1. A second uploaded PDF has artwork of its own.
    body: i === 0 ? input.body ?? [] : [],
    fields: input.fields.filter((f) => belongsTo(f, d.id, i === 0)).map(toField),
  }));

  const first = documents[0]!;
  return {
    pages: first.pages,
    body: first.body,
    sourcePdfKey: first.sourcePdfKey,
    fields: documents.flatMap((d) => d.fields),
    documents,
  };
}


/**
 * Freeze SEVERAL templates into ONE envelope.
 *
 * "Send docs" used to fire one envelope per checked template, so a customer got
 * three emails and signed three times for one job. Concatenating them here
 * means one link, one signature, and one merged PDF — the templates stay
 * separate to author and reuse, and only the send is joined.
 *
 * Document ids stay unique across the bundle because they are either row ids or
 * the template's own id, and field ids are row ids, so the flat `fields` list
 * is still an unambiguous lookup.
 */
export function buildEnvelopeSnapshot(
  templates: Parameters<typeof buildSnapshotFromTemplate>[0][],
): Snapshot {
  const parts = templates.map(buildSnapshotFromTemplate);
  const documents = parts
    .flatMap((p) => p.documents ?? [])
    // Bundle order is the order the templates were chosen, then each template's
    // own document order — which the parts already carry.
    .map((d, i) => ({ ...d, order: i + 1 }));

  const first = documents[0];
  if (!first) throw new Error("An envelope needs at least one document.");
  return {
    pages: first.pages,
    body: first.body,
    sourcePdfKey: first.sourcePdfKey,
    fields: documents.flatMap((d) => d.fields),
    documents,
    templateIds: templates.map((t) => t.templateId),
  };
}
