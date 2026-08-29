import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildEnvelopeSnapshot, buildSnapshotFromTemplate } from "@/server/modules/esign/build-snapshot";
import { envelopeDocuments, generateEnvelopePdf, mergePdfs } from "@/server/modules/esign/pdf";
import { buildAutofillContext } from "@/server/modules/esign/autofill";

const LETTER = { width: 612, height: 792 };

function field(over: Partial<Parameters<typeof buildSnapshotFromTemplate>[0]["fields"][number]> = {}) {
  return {
    id: "f1",
    documentId: null as string | null,
    page: 1,
    x: 60,
    y: 100,
    width: 180,
    height: 44,
    type: "signature",
    signerRole: "customer",
    label: "Sign",
    valueToken: null,
    defaultValue: null,
    ...over,
  };
}

const ctx = buildAutofillContext({ firstName: "Nancy", lastName: "Moore", companyName: "Anexa Homes" });

async function sourcePdf(pageCount: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([LETTER.width, LETTER.height]);
  return Buffer.from(await doc.save());
}

describe("buildSnapshotFromTemplate", () => {
  it("keeps a template with no document rows on its single-PDF shape", () => {
    const snapshot = buildSnapshotFromTemplate({
      templateId: "t1",
      name: "Install Agreement",
      pages: [LETTER],
      body: [],
      sourcePdfKey: "templates/t1.pdf",
      documents: [],
      fields: [field()],
    });

    expect(snapshot.sourcePdfKey).toBe("templates/t1.pdf");
    expect(snapshot.fields).toHaveLength(1);
    expect(envelopeDocuments(snapshot)).toHaveLength(1);
  });

  it("splits fields across the bundle and keeps the flat list whole", () => {
    const snapshot = buildSnapshotFromTemplate({
      templateId: "t1",
      name: "Install Agreement",
      pages: [],
      body: [],
      sourcePdfKey: null,
      documents: [
        { id: "d2", name: "Warranty", order: 2, sourcePdfKey: "b.pdf", pages: [LETTER] },
        { id: "d1", name: "Agreement", order: 1, sourcePdfKey: "a.pdf", pages: [LETTER, LETTER] },
      ],
      fields: [field({ id: "a", documentId: "d1" }), field({ id: "b", documentId: "d2" })],
    });

    const docs = envelopeDocuments(snapshot);
    // Bundle order comes from `order`, not from the row order handed in.
    expect(docs.map((d) => d.name)).toEqual(["Agreement", "Warranty"]);
    expect(docs[0].fields.map((f) => f.id)).toEqual(["a"]);
    expect(docs[1].fields.map((f) => f.id)).toEqual(["b"]);
    // The flat list is what signer-role filtering and field values key off.
    expect(snapshot.fields.map((f) => f.id).sort()).toEqual(["a", "b"]);
    expect(snapshot.sourcePdfKey).toBe("a.pdf");
  });

  it("puts an unassigned field on document 1 rather than dropping it", () => {
    // A field placed before the template was split, saved again afterwards by a
    // client that still had no documentId for it. Dropping it would send a
    // contract with nowhere to sign.
    const snapshot = buildSnapshotFromTemplate({
      templateId: "t1",
      name: "Install Agreement",
      pages: [],
      body: [],
      sourcePdfKey: null,
      documents: [
        { id: "d1", name: "Agreement", order: 1, sourcePdfKey: "a.pdf", pages: [LETTER] },
        { id: "d2", name: "Warranty", order: 2, sourcePdfKey: "b.pdf", pages: [LETTER] },
      ],
      fields: [field({ id: "orphan", documentId: null }), field({ id: "gone", documentId: "deleted-doc" })],
    });

    const docs = envelopeDocuments(snapshot);
    expect(docs[0].fields.map((f) => f.id)).toEqual(["orphan", "gone"]);
    expect(docs[1].fields).toHaveLength(0);
    expect(snapshot.fields).toHaveLength(2);
  });

  it("carries a legacy template's NULL-documentId fields onto its one document", () => {
    const snapshot = buildSnapshotFromTemplate({
      templateId: "t1",
      name: "Install Agreement",
      pages: [],
      body: [],
      sourcePdfKey: null,
      documents: [{ id: "d1", name: "Agreement", order: 1, sourcePdfKey: "a.pdf", pages: [LETTER] }],
      fields: [field({ id: "a", documentId: null })],
    });

    expect(envelopeDocuments(snapshot)[0].fields.map((f) => f.id)).toEqual(["a"]);
  });
});

describe("generateEnvelopePdf", () => {
  const signers = [
    {
      name: "Nancy Moore",
      email: "nancy@example.com",
      signedAt: new Date("2026-08-28T12:00:00Z"),
      ip: "203.0.113.7",
      role: "customer",
      status: "signed",
    },
  ];

  it("merges every document into one file with a single certificate", async () => {
    const sources: Record<string, Buffer> = {
      "a.pdf": await sourcePdf(3),
      "b.pdf": await sourcePdf(2),
    };
    const snapshot = buildSnapshotFromTemplate({
      templateId: "t1",
      name: "Install Agreement",
      pages: [],
      body: [],
      sourcePdfKey: null,
      documents: [
        { id: "d1", name: "Agreement", order: 1, sourcePdfKey: "a.pdf", pages: [LETTER, LETTER, LETTER] },
        { id: "d2", name: "Warranty", order: 2, sourcePdfKey: "b.pdf", pages: [LETTER, LETTER] },
      ],
      fields: [field({ id: "a", documentId: "d1" }), field({ id: "b", documentId: "d2", page: 2 })],
    });

    const withCert = await PDFDocument.load(
      await generateEnvelopePdf({
        title: "Install Agreement",
        snapshot,
        ctx,
        values: {},
        signers,
        events: [],
        loadSource: async (k) => sources[k] ?? null,
      }),
    );
    const noCert = await PDFDocument.load(
      await generateEnvelopePdf({
        title: "Install Agreement",
        snapshot,
        ctx,
        values: {},
        signers,
        events: [],
        certificate: false,
        loadSource: async (k) => sources[k] ?? null,
      }),
    );

    // 3 + 2 content pages, and exactly one certificate closing the bundle —
    // not one per document.
    expect(noCert.getPageCount()).toBe(5);
    expect(withCert.getPageCount()).toBe(6);
  });

  it("renders a single-document envelope exactly as before", async () => {
    const snapshot = buildSnapshotFromTemplate({
      templateId: "t1",
      name: "Install Agreement",
      pages: [LETTER],
      body: [],
      sourcePdfKey: "a.pdf",
      documents: [],
      fields: [field()],
    });
    const source = await sourcePdf(2);

    const out = await PDFDocument.load(
      await generateEnvelopePdf({
        title: "Install Agreement",
        snapshot,
        ctx,
        values: {},
        signers,
        events: [],
        loadSource: async () => source,
      }),
    );
    expect(out.getPageCount()).toBe(3); // 2 content + 1 certificate
  });

  it("still produces a file when a document's PDF is missing from storage", async () => {
    const snapshot = buildSnapshotFromTemplate({
      templateId: "t1",
      name: "Install Agreement",
      pages: [],
      body: [],
      sourcePdfKey: null,
      documents: [
        { id: "d1", name: "Agreement", order: 1, sourcePdfKey: "a.pdf", pages: [LETTER] },
        { id: "d2", name: "Warranty", order: 2, sourcePdfKey: "gone.pdf", pages: [LETTER] },
      ],
      fields: [],
    });

    const buf = await generateEnvelopePdf({
      title: "Install Agreement",
      snapshot,
      ctx,
      values: {},
      signers,
      events: [],
      loadSource: async (k) => (k === "a.pdf" ? await sourcePdf(1) : null),
    });
    // The absent PDF falls back to its generated page model rather than
    // aborting the whole envelope.
    expect((await PDFDocument.load(buf)).getPageCount()).toBe(3);
  });
});

describe("mergePdfs", () => {
  it("concatenates in the order given", async () => {
    const merged = await mergePdfs([await sourcePdf(2), await sourcePdf(3)]);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(5);
  });
});


describe("buildEnvelopeSnapshot", () => {
  const tpl = (id: string, name: string, docs: { id: string; name: string }[]) => ({
    templateId: id,
    name,
    pages: [LETTER],
    body: [],
    sourcePdfKey: docs.length ? null : `${id}.pdf`,
    documents: docs.map((d, i) => ({
      id: d.id,
      name: d.name,
      order: i + 1,
      sourcePdfKey: `${d.id}.pdf`,
      pages: [LETTER],
    })),
    fields: [field({ id: `${id}-f`, documentId: docs[0]?.id ?? null })],
  });

  it("concatenates several templates into one envelope, in the order given", () => {
    const snapshot = buildEnvelopeSnapshot([
      tpl("t1", "Install Agreement", [{ id: "d1", name: "Agreement" }, { id: "d2", name: "Exhibit A" }]),
      tpl("t2", "Limited Warranty", []),
    ]);

    const docs = envelopeDocuments(snapshot);
    expect(docs.map((d) => d.name)).toEqual(["Agreement", "Exhibit A", "Limited Warranty"]);
    // Bundle order is renumbered end to end, so the merged PDF prints in order.
    expect(docs.map((d) => d.order)).toEqual([1, 2, 3]);
    expect(snapshot.templateIds).toEqual(["t1", "t2"]);
  });

  it("keeps document ids unique when two single-PDF templates are bundled", () => {
    // Both fall back to a synthesised document. Sharing one id would collide in
    // the `?doc=` lookup and serve the wrong PDF to the signer.
    const snapshot = buildEnvelopeSnapshot([tpl("t1", "One", []), tpl("t2", "Two", [])]);
    const ids = envelopeDocuments(snapshot).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every template's fields reachable in the flat list", () => {
    const snapshot = buildEnvelopeSnapshot([
      tpl("t1", "Install Agreement", [{ id: "d1", name: "Agreement" }]),
      tpl("t2", "Limited Warranty", [{ id: "d3", name: "Warranty" }]),
    ]);
    expect(snapshot.fields.map((f) => f.id).sort()).toEqual(["t1-f", "t2-f"]);
    const docs = envelopeDocuments(snapshot);
    expect(docs[0].fields.map((f) => f.id)).toEqual(["t1-f"]);
    expect(docs[1].fields.map((f) => f.id)).toEqual(["t2-f"]);
  });

  it("leaves a single template exactly as it was", () => {
    const one = buildEnvelopeSnapshot([tpl("t1", "Install Agreement", [])]);
    expect(envelopeDocuments(one)).toHaveLength(1);
    expect(one.sourcePdfKey).toBe("t1.pdf");
    expect(one.templateIds).toEqual(["t1"]);
  });
});
