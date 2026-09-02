"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import SignatureCanvas from "react-signature-canvas";
import { Archive, Check, Loader2, PenLine, Plus, Trash2, Type, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/portal/ui";
import {
  Caution,
  FieldGrid,
  Hint,
  ItemRail,
  Panel,
  RailGroup,
  RailLayout,
  RailNoMatch,
  RailRow,
  SaveBar,
  TextField,
  ToggleRow,
  useDraft,
} from "@/components/portal/settings-kit";
import { cursiveImage } from "@/lib/signature-image";
import { deriveInitials } from "@/lib/esign-signature";
import {
  saveCompanySignerAction,
  saveSignerMarkAction,
  setCompanySignerActiveAction,
  uploadSignerMarkAction,
} from "@/server/modules/settings/signer-actions";

export type SignerCredentialRow = { key: string; label: string; value: string };

export type SignerRow = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  licenseNumber: string;
  credentials: SignerCredentialRow[];
  signatureData: string | null;
  initialsData: string | null;
  isDefault: boolean;
  active: boolean;
};

/** A signer with no mark cannot sign anything — the rail says so before you open them. */
function needsWork(s: SignerRow): boolean {
  return !s.signatureData;
}

function railLine(s: SignerRow): string {
  if (!s.signatureData) return "no signature saved";
  return [s.title || "no title", s.licenseNumber ? `#${s.licenseNumber}` : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Everyone authorised to sign on the company's behalf.
 *
 * A rail and a panel, like every other list-of-things screen in Settings. The
 * thing this one holds that the others do not is a signature that will be
 * applied to a contract without its owner in the room, so the panel leads with
 * the authorisation that makes that legitimate rather than burying it.
 */
export function CompanySignerManager({
  signers,
  canEdit,
  initialSignerId,
}: {
  signers: SignerRow[];
  canEdit: boolean;
  /** Read on the SERVER — see the note on the page. */
  initialSignerId?: string | null;
}) {
  const router = useRouter();
  const live = signers.filter((s) => s.active);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialSignerId ?? live[0]?.id ?? signers[0]?.id ?? null
  );
  const [query, setQuery] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const selected = signers.find((s) => s.id === selectedId) ?? live[0] ?? signers[0] ?? null;

  // Moving between signers is not a navigation, so it replaces rather than
  // pushes — but a reload still lands on the same person.
  const idInUrl = selected?.id ?? null;
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (idInUrl) p.set("signer", idInUrl);
    else p.delete("signer");
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [idInUrl]);

  async function addSigner() {
    setAdding(true);
    const res = await saveCompanySignerAction({
      name: "New signer",
      credentials: [],
      // The first one added becomes the default, because a company with exactly
      // one authorised signer and no default is a company whose contracts all
      // refuse to send.
      isDefault: signers.length === 0,
      active: true,
    });
    setAdding(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSelectedId(res.id);
    router.refresh();
  }

  const addButton = canEdit ? (
    <Button size="sm" variant="outline" onClick={addSigner} disabled={adding}>
      {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      New signer
    </Button>
  ) : undefined;

  if (signers.length === 0) {
    return (
      <EmptyState
        icon={PenLine}
        title="Nobody signs for the company yet"
        description="Add whoever signs your contracts — their name, title, licence and signature. Any template with a company signature block then fills itself when it is sent, instead of waiting on somebody to open a link."
        action={addButton}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const shown = signers.filter((s) => q === "" || s.name.toLowerCase().includes(q));
  const shownLive = shown.filter((s) => s.active);
  const shownRetired = shown.filter((s) => !s.active);

  const railRow = (s: SignerRow) => (
    <RailRow
      key={s.id}
      title={s.name}
      subtitle={railLine(s)}
      selected={s.id === selected?.id}
      onSelect={() => setSelectedId(s.id)}
      needsWork={s.active && needsWork(s)}
      muted={!s.active}
      trailing={
        s.isDefault ? (
          <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-gold">
            Default
          </span>
        ) : undefined
      }
    />
  );

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Authorised signers"
          add={addButton}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Find a signer"
          showSearch={signers.length > 6}
        >
          {shownLive.map(railRow)}
          {shownRetired.length > 0 && <RailGroup>Retired ({shownRetired.length})</RailGroup>}
          {shownRetired.map(railRow)}
          {shown.length === 0 && <RailNoMatch query={query} />}
        </ItemRail>
      }
    >
      {selected && (
        // Keyed so switching signers remounts the panel: a draft belongs to the
        // person it was seeded from.
        <SignerPanel key={selected.id} row={selected} canEdit={canEdit} />
      )}
    </RailLayout>
  );
}

type Draft = {
  name: string;
  title: string;
  email: string;
  phone: string;
  licenseNumber: string;
  credentials: SignerCredentialRow[];
  isDefault: boolean;
  active: boolean;
};

function SignerPanel({ row, canEdit }: { row: SignerRow; canEdit: boolean }) {
  const router = useRouter();
  const seed: Draft = React.useMemo(
    () => ({
      name: row.name,
      title: row.title,
      email: row.email,
      phone: row.phone,
      licenseNumber: row.licenseNumber,
      credentials: row.credentials,
      isDefault: row.isDefault,
      active: row.active,
    }),
    [row]
  );
  const { draft, set, setDraft, dirty, reset } = useDraft(seed);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!draft.name.trim()) {
      toast.error("A signer needs a name.");
      return;
    }
    setBusy(true);
    const res = await saveCompanySignerAction({ id: row.id, ...draft });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Signer saved.");
    router.refresh();
  }

  async function setActive(active: boolean) {
    setBusy(true);
    const res = await setCompanySignerActiveAction(row.id, active);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(active ? "Signer restored." : "Signer retired.");
    router.refresh();
  }

  function addCredential() {
    setDraft((d) => ({ ...d, credentials: [...d.credentials, { key: "", label: "", value: "" }] }));
  }

  function updateCredential(i: number, patch: Partial<SignerCredentialRow>) {
    setDraft((d) => ({
      ...d,
      credentials: d.credentials.map((c, n) => (n === i ? { ...c, ...patch } : c)),
    }));
  }

  function removeCredential(i: number) {
    setDraft((d) => ({ ...d, credentials: d.credentials.filter((_, n) => n !== i) }));
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Standing authorisation"
        tone="accent"
        description="This person's signature is applied automatically when a document with a company signature block is sent — they are not emailed a link and do not have to be at a desk."
      >
        <Caution>
          Keep this person&apos;s written authorisation to sign on the company&apos;s behalf on
          file, outside this system. Every document records who applied the signature and on whose
          authority, which is only worth something if the authority exists.
        </Caution>
      </Panel>

      <Panel title="Who they are" description="What prints in the signature block of a contract.">
        <FieldGrid>
          <TextField
            label="Full name"
            value={draft.name}
            onChange={(v) => set("name", v)}
            placeholder="Mustafa Joulani"
            hint="Maps to {{signer.name}}."
          />
          <TextField
            label="Job title"
            value={draft.title}
            onChange={(v) => set("title", v)}
            placeholder="Owner"
            hint="Maps to {{signer.title}}."
          />
        </FieldGrid>
        <FieldGrid>
          <TextField
            label="Email"
            type="email"
            value={draft.email}
            onChange={(v) => set("email", v)}
            placeholder="owner@example.com"
            why="Printed where a form asks for the signer's own address — never used to send them anything. Their signature is already applied by the time the document goes out."
          />
          <TextField
            label="Direct phone"
            value={draft.phone}
            onChange={(v) => set("phone", v)}
            placeholder="(555) 222-3344"
            hint="Maps to {{signer.phone}}."
          />
        </FieldGrid>
        <TextField
          label="Licence / registration number"
          value={draft.licenseNumber}
          onChange={(v) => set("licenseNumber", v)}
          placeholder="TX-12345"
          hint="Maps to {{signer.license}}."
        />
      </Panel>

      <Panel
        title="Other credentials"
        description="Anything else a form asks this person for — a NABCEP number, a state registration. Each line becomes its own field you can map onto a document."
        action={
          canEdit ? (
            <Button size="sm" variant="outline" onClick={addCredential}>
              <Plus className="size-4" /> Add line
            </Button>
          ) : undefined
        }
      >
        {draft.credentials.length === 0 ? (
          <Hint>None yet. Most companies need one or two beyond the licence above.</Hint>
        ) : (
          <div className="space-y-2">
            {draft.credentials.map((c, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Label</Label>
                  <Input
                    value={c.label}
                    onChange={(e) => updateCredential(i, { label: e.target.value })}
                    placeholder="NABCEP #"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Value</Label>
                  <Input
                    value={c.value}
                    onChange={(e) => updateCredential(i, { value: e.target.value })}
                    placeholder="PV-041234"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${c.label || "credential"}`}
                  onClick={() => removeCredential(i)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
            <Hint>
              Renaming a label keeps any document already mapped to it working — the field it
              points at does not move.
            </Hint>
          </div>
        )}
      </Panel>

      <Panel
        title="Signature"
        description="Drawn, typed or uploaded. This exact image is stamped into every signature field assigned to the company."
      >
        <MarkEditor
          signerId={row.id}
          which="signature"
          label="Signature"
          name={row.name}
          current={row.signatureData}
          canEdit={canEdit}
        />
      </Panel>

      <Panel
        title="Initials"
        description="Used for Initials fields. Leave it empty and the signature above is used instead, scaled down."
      >
        <MarkEditor
          signerId={row.id}
          which="initials"
          label="Initials"
          name={deriveInitials(row.name) || row.name}
          current={row.initialsData}
          canEdit={canEdit}
        />
      </Panel>

      <Panel title="How this signer is used">
        {/*
          * The default cannot be switched OFF here, only moved: turning it off
          * would leave the company with no default at all, and the first thing
          * anybody would learn about that is a contract refusing to send. You
          * hand it to somebody else instead, and this row clears itself.
          */}
        <ToggleRow
          label="Default signer"
          description={
            row.isDefault
              ? "Signs anything whose template does not name somebody else. To move it, switch this on for another signer."
              : "Signs anything whose template does not name somebody else. Turning this on takes it from whoever holds it now."
          }
          checked={draft.isDefault}
          onChange={(v) => set("isDefault", v)}
          disabled={!canEdit || row.isDefault}
        />
        <div className="pt-1">
          {row.active ? (
            <Button variant="outline" size="sm" disabled={!canEdit || busy} onClick={() => setActive(false)}>
              <Archive className="size-4" /> Retire this signer
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={!canEdit || busy} onClick={() => setActive(true)}>
              <Undo2 className="size-4" /> Bring back
            </Button>
          )}
          <Hint className="mt-2">
            Retiring keeps every contract they have already signed intact, and stops them being
            picked for anything new. Templates pointing at them fall back to the default.
          </Hint>
        </div>
      </Panel>

      {canEdit && (
        <SaveBar dirty={dirty} busy={busy} onSave={save} onDiscard={reset} what={row.name} />
      )}
    </div>
  );
}

/**
 * One saved mark — draw it, type it, or upload a scan.
 *
 * Saved on its own rather than through the screen's SaveBar: a signature is an
 * image, not a form value, and it goes through a server round trip that
 * re-encodes it. Folding that into "Save changes" would mean a Save that
 * sometimes uploads a file and sometimes does not.
 */
function MarkEditor({
  signerId,
  which,
  label,
  name,
  current,
  canEdit,
}: {
  signerId: string;
  which: "signature" | "initials";
  label: string;
  name: string;
  current: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"draw" | "type" | null>(null);
  const [typed, setTyped] = React.useState(name);
  const [busy, setBusy] = React.useState(false);
  const padRef = React.useRef<SignatureCanvas | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  async function persist(dataUrl: string | null) {
    setBusy(true);
    const res = await saveSignerMarkAction({ id: signerId, which, dataUrl });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setMode(null);
    toast.success(dataUrl ? `${label} saved.` : `${label} cleared.`);
    router.refresh();
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.set("id", signerId);
    fd.set("which", which);
    fd.set("file", file);
    setBusy(true);
    const res = await uploadSignerMarkAction(fd);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${label} saved.`);
    router.refresh();
  }

  function saveDrawn() {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      toast.error(`Draw the ${label.toLowerCase()} first.`);
      return;
    }
    void persist(pad.getCanvas().toDataURL("image/png"));
  }

  return (
    <div className="space-y-3">
      <div className="grid h-28 place-items-center overflow-hidden rounded-lg border border-border bg-white">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL, not a served asset
          <img src={current} alt={`${label} preview`} className="max-h-24 max-w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">No {label.toLowerCase()} saved yet</span>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode(mode === "draw" ? null : "draw")}>
            <PenLine className="size-4" /> Draw
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode(mode === "type" ? null : "type")}>
            <Type className="size-4" /> Type
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Upload
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            aria-label={`Upload ${label.toLowerCase()}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Cleared so choosing the same file twice still fires a change.
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          {current && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void persist(null)}>
              Clear
            </Button>
          )}
        </div>
      )}

      {mode === "draw" && (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg border border-border bg-white">
            <SignatureCanvas
              ref={padRef}
              penColor="#0B0B0C"
              canvasProps={{ className: "w-full", height: which === "signature" ? 180 : 120 }}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={saveDrawn} className="bg-gold text-gold-foreground hover:bg-gold/90">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save {label.toLowerCase()}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => padRef.current?.clear()}>
              Clear pad
            </Button>
          </div>
        </div>
      )}

      {mode === "type" && (
        <div className="space-y-2">
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type the ${label.toLowerCase()}`} />
          <div className="grid h-24 place-items-center rounded-lg border border-border bg-white">
            <span className="text-4xl text-black" style={{ fontFamily: "'Brush Script MT', cursive" }}>
              {typed || label}
            </span>
          </div>
          <Button
            size="sm"
            disabled={busy || !typed.trim()}
            onClick={() => void persist(cursiveImage(typed, which === "signature" ? 600 : 240, 200))}
            className="bg-gold text-gold-foreground hover:bg-gold/90"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save {label.toLowerCase()}
          </Button>
        </div>
      )}
    </div>
  );
}
