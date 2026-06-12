"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Search,
  FileText,
  PlayCircle,
  Link2,
  BookOpen,
  Pencil,
  Trash2,
  Loader2,
  Download,
  ExternalLink,
  GraduationCap,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/portal/ui";
import { PdfCanvas, getPdfNumPages } from "@/components/esign/pdf-canvas";
import {
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
  createItemAction,
  updateItemAction,
  deleteItemAction,
} from "@/server/modules/knowledge/actions";

type ItemType = "file" | "video" | "link" | "article";

type Item = {
  id: string;
  type: ItemType;
  title: string;
  description: string | null;
  url: string | null;
  body: string | null;
  hasFile?: boolean;
  isPdf?: boolean;
  createdAt?: string;
};

type Category = {
  id: string;
  name: string;
  description: string | null;
  visibleRoles: string[];
  items: Item[];
};

type RoleOption = { value: string; label: string };

const TYPE_META: Record<ItemType, { icon: React.ElementType; label: string }> = {
  file: { icon: FileText, label: "File" },
  video: { icon: PlayCircle, label: "Video" },
  link: { icon: Link2, label: "Link" },
  article: { icon: BookOpen, label: "Article" },
};

export function KnowledgeClient({
  categories,
  canManage,
  roleOptions,
}: {
  categories: Category[];
  canManage: boolean;
  roleOptions: RoleOption[];
}) {
  const [query, setQuery] = React.useState("");
  const [newCategoryOpen, setNewCategoryOpen] = React.useState(false);

  const q = query.trim().toLowerCase();

  // Flat list of every visible item, tagged with its category — powers the
  // search-results gallery and the "Recently added" strip.
  const allItems = categories.flatMap((c) => c.items.map((item) => ({ item, categoryName: c.name })));
  const searchResults = q
    ? allItems.filter(
        ({ item }) =>
          item.title.toLowerCase().includes(q) || (item.description ?? "").toLowerCase().includes(q)
      )
    : [];
  const recent = [...allItems]
    .sort((a, b) => (b.item.createdAt ?? "").localeCompare(a.item.createdAt ?? ""))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search training materials…"
            className="pl-9"
          />
        </div>
        {canManage && (
          <Button onClick={() => setNewCategoryOpen(true)}>
            <Plus className="size-4" /> New category
          </Button>
        )}
      </div>

      {q ? (
        // Search mode: a flat gallery of matching cards across every category.
        searchResults.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No matching materials" description="Try a different search." />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for &ldquo;{query.trim()}&rdquo;
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {searchResults.map(({ item, categoryName }) => (
                <ItemCard key={item.id} item={item} canManage={canManage} categoryName={categoryName} />
              ))}
            </div>
          </div>
        )
      ) : categories.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No training yet"
          description={
            canManage
              ? "Create a category and start uploading training materials for your team."
              : "No training has been shared with your role yet."
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Highlight the newest materials across all categories. */}
          {allItems.length > 4 && (
            <div className="space-y-3">
              <h2 className="font-display text-lg font-semibold tracking-tight">Recently added</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {recent.map(({ item, categoryName }) => (
                  <ItemCard key={`recent-${item.id}`} item={item} canManage={canManage} categoryName={categoryName} />
                ))}
              </div>
            </div>
          )}
          {categories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              canManage={canManage}
              roleOptions={roleOptions}
            />
          ))}
        </div>
      )}

      {canManage && (
        <CategoryDialog
          open={newCategoryOpen}
          onOpenChange={setNewCategoryOpen}
          roleOptions={roleOptions}
        />
      )}
    </div>
  );
}

function CategoryCard({
  category,
  canManage,
  roleOptions,
}: {
  category: Category;
  canManage: boolean;
  roleOptions: RoleOption[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [addItemOpen, setAddItemOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    if (!confirm(`Delete “${category.name}” and all its materials?`)) return;
    setBusy(true);
    const res = await deleteCategoryAction(category.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Category deleted.");
    router.refresh();
  }

  const roleLabels = category.visibleRoles
    .map((r) => roleOptions.find((o) => o.value === r)?.label ?? r)
    .filter(Boolean);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">{category.name}</h2>
          {category.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{category.description}</p>
          )}
          {canManage && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Visible to:</span>
              {roleLabels.length > 0 ? (
                roleLabels.map((l) => (
                  <Badge key={l} variant="secondary" className="text-xs">
                    {l}
                  </Badge>
                ))
              ) : (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Management only
                </Badge>
              )}
            </div>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setAddItemOpen(true)}>
              <Plus className="size-4" /> Add
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setEditOpen(true)} aria-label="Edit category">
              <Pencil className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={remove} disabled={busy} aria-label="Delete category">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          </div>
        )}
      </div>

      <div className="p-4">
        {category.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No materials in this category yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {category.items.map((item) => (
              <ItemCard key={item.id} item={item} canManage={canManage} />
            ))}
          </div>
        )}
      </div>

      {canManage && (
        <>
          <CategoryDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            roleOptions={roleOptions}
            category={category}
          />
          <ItemDialog open={addItemOpen} onOpenChange={setAddItemOpen} categoryId={category.id} />
        </>
      )}
    </div>
  );
}

/** Lazily renders the first page of a PDF as a cover thumbnail once scrolled into view. */
function PdfThumb({ url }: { url: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div
      ref={ref}
      className="relative aspect-[4/3] w-full overflow-hidden border-b border-border bg-muted"
    >
      {visible ? (
        <PdfCanvas url={url} page={1} className="block w-full" hideOpenLink />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <FileText className="size-8" />
        </div>
      )}
    </div>
  );
}

/** Full-screen, read-only PDF viewer. No download/print; right-click and selection disabled. */
function PdfViewerModal({
  open,
  onOpenChange,
  url,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  url: string;
  title: string;
}) {
  const [numPages, setNumPages] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNumPages(0);
    getPdfNumPages(url)
      .then((n) => {
        if (!cancelled) setNumPages(n);
      })
      .catch(() => {
        /* PdfCanvas shows its own error state */
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-4xl"
        onContextMenu={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="truncate pr-8">{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[calc(92vh-3.5rem)] select-none space-y-4 overflow-y-auto bg-muted/40 p-4">
          {numPages === 0 ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                className="relative mx-auto aspect-[8.5/11] w-full max-w-3xl bg-white shadow-sm"
              >
                <PdfCanvas url={url} page={i + 1} className="block w-full" hideOpenLink />
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ItemCard({ item, canManage, categoryName }: { item: Item; canManage: boolean; categoryName?: string }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [articleOpen, setArticleOpen] = React.useState(false);
  const [pdfOpen, setPdfOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const Meta = TYPE_META[item.type];
  const fileHref = `/portal/knowledge/items/${item.id}/file`;
  const isPdf = item.type === "file" && !!item.isPdf;

  async function remove() {
    if (!confirm(`Delete “${item.title}”?`)) return;
    setBusy(true);
    const res = await deleteItemAction(item.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Item deleted.");
    router.refresh();
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-sm">
      {/* Thumbnail */}
      {isPdf ? (
        <PdfThumb url={fileHref} />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center border-b border-border bg-muted text-muted-foreground">
          <Meta.icon className="size-10" />
        </div>
      )}

      {/* Management controls, on hover */}
      {canManage && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button size="icon" variant="secondary" onClick={() => setEditOpen(true)} aria-label="Edit item">
            <Pencil className="size-4" />
          </Button>
          <Button size="icon" variant="secondary" onClick={remove} disabled={busy} aria-label="Delete item">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </Button>
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-medium leading-tight">{item.title}</h3>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {Meta.label}
          </Badge>
        </div>
        {item.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
        )}
        {categoryName && (
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
            {categoryName}
          </span>
        )}

        <div className="mt-auto pt-1">
          {isPdf && (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setPdfOpen(true)}>
              <Eye className="size-4" /> View
            </Button>
          )}
          {item.type === "file" && !isPdf && (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={fileHref} target="_blank" rel="noopener noreferrer">
                <Download className="size-4" /> Open
              </a>
            </Button>
          )}
          {item.type === "video" && (item.url || item.hasFile) && (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={item.url || fileHref} target="_blank" rel="noopener noreferrer">
                {item.url ? <ExternalLink className="size-4" /> : <PlayCircle className="size-4" />} Watch
              </a>
            </Button>
          )}
          {item.type === "link" && item.url && (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" /> Open
              </a>
            </Button>
          )}
          {item.type === "article" && (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setArticleOpen(true)}>
              <BookOpen className="size-4" /> Read
            </Button>
          )}
        </div>
      </div>

      {/* Modals */}
      {item.type === "article" && (
        <Dialog open={articleOpen} onOpenChange={setArticleOpen}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{item.title}</DialogTitle>
              {item.description && <DialogDescription>{item.description}</DialogDescription>}
            </DialogHeader>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.body}</div>
          </DialogContent>
        </Dialog>
      )}
      {isPdf && (
        <PdfViewerModal open={pdfOpen} onOpenChange={setPdfOpen} url={fileHref} title={item.title} />
      )}
      {canManage && <ItemDialog open={editOpen} onOpenChange={setEditOpen} item={item} />}
    </div>
  );
}

function CategoryDialog({
  open,
  onOpenChange,
  roleOptions,
  category,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roleOptions: RoleOption[];
  category?: Category;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mount fresh on each open so the form initializes from current props. */}
        {open && (
          <CategoryForm
            roleOptions={roleOptions}
            category={category}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  roleOptions,
  category,
  onClose,
}: {
  roleOptions: RoleOption[];
  category?: Category;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(category?.name ?? "");
  const [description, setDescription] = React.useState(category?.description ?? "");
  const [roles, setRoles] = React.useState<string[]>(category?.visibleRoles ?? []);
  const [busy, setBusy] = React.useState(false);

  function toggleRole(value: string) {
    setRoles((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]
    );
  }

  async function submit() {
    setBusy(true);
    const res = category
      ? await updateCategoryAction({ id: category.id, name, description, visibleRoles: roles })
      : await createCategoryAction({ name, description, visibleRoles: roles });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(category ? "Category updated." : "Category created.");
    onClose();
    router.refresh();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
        <DialogDescription>
          Choose which roles can see this category. Admins and managers always see everything.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales Rep Training" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Description (optional)</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's in this category?"
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Visible to roles</label>
          <div className="grid grid-cols-2 gap-2">
            {roleOptions.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={roles.includes(opt.value)}
                  onCheckedChange={() => toggleRole(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Leave all unchecked to keep this category management-only.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy || !name.trim()}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {category ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ItemDialog({
  open,
  onOpenChange,
  categoryId,
  item,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categoryId?: string;
  item?: Item;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {/* Mount fresh on each open so the form initializes from current props. */}
        {open && (
          <ItemForm categoryId={categoryId} item={item} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemForm({
  categoryId,
  item,
  onClose,
}: {
  categoryId?: string;
  item?: Item;
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = !!item;
  const [type, setType] = React.useState<ItemType>(item?.type ?? "file");
  const [title, setTitle] = React.useState(item?.title ?? "");
  const [description, setDescription] = React.useState(item?.description ?? "");
  const [url, setUrl] = React.useState(item?.url ?? "");
  const [body, setBody] = React.useState(item?.body ?? "");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!title.trim()) return toast.error("Title is required.");
    setBusy(true);
    let res;
    if (editing) {
      res = await updateItemAction({ id: item!.id, title, description, url, body });
    } else {
      const fd = new FormData();
      fd.set("categoryId", categoryId ?? "");
      fd.set("type", type);
      fd.set("title", title);
      fd.set("description", description);
      fd.set("url", url);
      fd.set("body", body);
      if (file) fd.set("file", file);
      res = await createItemAction(fd);
    }
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(editing ? "Item updated." : "Item added.");
    onClose();
    router.refresh();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit item" : "Add training material"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
          {!editing && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={type} onValueChange={(v) => setType(v as ItemType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">File (PDF, PowerPoint, doc, image)</SelectItem>
                  <SelectItem value="video">Video (upload or embed URL)</SelectItem>
                  <SelectItem value="link">External link</SelectItem>
                  <SelectItem value="article">Article (written here)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Door-knocking script" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Short summary"
            />
          </div>

          {!editing && type === "file" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">File</label>
              <Input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                PDF, PowerPoint, Word, Excel, or images — up to 30MB.
              </p>
            </div>
          )}

          {type === "link" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">URL</label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}

          {type === "video" && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Video URL {editing ? "" : "(optional)"}
                </label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://youtube.com/… or Vimeo, Loom, etc."
                />
              </div>
              {!editing && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">…or upload a video file</label>
                  <Input
                    type="file"
                    accept="video/*,.mp4,.m4v,.mov,.webm,.ogv,.avi,.mkv"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">
                    MP4, MOV, WebM, and similar — up to 250MB. Leave the URL blank if you upload a file.
                  </p>
                </div>
              )}
            </>
          )}

          {type === "article" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Content</label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Write the training content here…"
              />
            </div>
          )}

          {editing && type === "file" && (
            <p className="text-xs text-muted-foreground">
              To replace the uploaded file, delete this item and add a new one.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
    </>
  );
}
