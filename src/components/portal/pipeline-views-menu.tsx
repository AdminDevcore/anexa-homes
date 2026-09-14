"use client";

import * as React from "react";
import { Bookmark, Check, ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Condition, MatchMode } from "@/lib/pipeline-filters";

export type SavedFilterView = {
  id: string;
  name: string;
  shared: boolean;
  conditions: Condition[];
  /** How the saved rows combine: and ("all") or or ("any"). */
  match: MatchMode;
  /** Made by the person looking at it. */
  mine: boolean;
  /** Theirs, or a shared view and they may manage shared views. */
  canEdit: boolean;
};

/**
 * Saved filters. Picking one replaces the filters on the board; the dot on the
 * button says the board has since drifted from what the view saved.
 */
export function PipelineViewsMenu({
  views,
  active,
  dirty,
  hasFilters,
  canShare,
  onSelect,
  onSaveNew,
  onUpdate,
  onEdit,
  onDelete,
}: {
  views: SavedFilterView[];
  active: SavedFilterView | null;
  dirty: boolean;
  hasFilters: boolean;
  canShare: boolean;
  onSelect: (view: SavedFilterView | null) => void;
  onSaveNew: () => void;
  onUpdate: (view: SavedFilterView) => void;
  onEdit: (view: SavedFilterView) => void;
  onDelete: (view: SavedFilterView) => void;
}) {
  const mine = views.filter((v) => v.mine && !v.shared);
  const shared = views.filter((v) => v.shared);

  return (
    // Non-modal: a modal menu that opens a dialog leaves pointer-events stuck on
    // <body> once both close.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          className="max-w-[15rem] shrink-0"
          aria-label={active ? `Views (${active.name}${dirty ? ", edited" : ""})` : "Views"}
        >
          <Bookmark className="size-4" />
          <span className="truncate">{active ? active.name : "Views"}</span>
          {active && dirty ? <span className="size-1.5 shrink-0 rounded-full bg-gold" aria-hidden /> : null}
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={() => onSelect(null)}>
          <span className="flex-1">All deals</span>
          {!active ? <Check className="size-4" aria-hidden /> : null}
        </DropdownMenuItem>

        {mine.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>My views</DropdownMenuLabel>
              {mine.map((v) => (
                <ViewItem key={v.id} view={v} active={active?.id === v.id} onSelect={onSelect} />
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}

        {shared.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Shared with the team</DropdownMenuLabel>
              {shared.map((v) => (
                <ViewItem key={v.id} view={v} active={active?.id === v.id} onSelect={onSelect} />
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hasFilters} onSelect={onSaveNew}>
          Save current filters as a new view…
        </DropdownMenuItem>
        {active?.canEdit ? (
          <>
            {dirty ? (
              <DropdownMenuItem onSelect={() => onUpdate(active)}>
                {`Update “${active.name}” with current filters`}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => onEdit(active)}>
              {`${canShare ? "Rename or share" : "Rename"} “${active.name}”…`}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(active)}>
              {`Delete “${active.name}”…`}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewItem({
  view,
  active,
  onSelect,
}: {
  view: SavedFilterView;
  active: boolean;
  onSelect: (view: SavedFilterView) => void;
}) {
  const Icon = view.shared ? Users : Bookmark;
  return (
    <DropdownMenuItem onSelect={() => onSelect(view)}>
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{view.name}</span>
      {active ? <Check className="size-4" aria-hidden /> : null}
    </DropdownMenuItem>
  );
}

/** Name (and, for a manager, share) a view. Remount with a new `key` to reset it. */
export function SaveViewDialog({
  open,
  onOpenChange,
  title,
  initialName,
  initialShared,
  canShare,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialName: string;
  initialShared: boolean;
  canShare: boolean;
  pending: boolean;
  onSubmit: (name: string, shared: boolean) => void;
}) {
  const [name, setName] = React.useState(initialName);
  const [shared, setShared] = React.useState(initialShared);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim(), shared);
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Reopen these filters from Views in one click.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor="pipeline-view-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="pipeline-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Overdue NTP"
              autoFocus
            />
          </div>
          {canShare ? (
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <Checkbox checked={shared} onCheckedChange={(v) => setShared(v === true)} className="mt-0.5" />
              <span>
                <span className="font-medium">Share with the whole team</span>
                <span className="block text-xs text-muted-foreground">
                  Everyone on this pipeline sees it under Views. Each person still only sees the deals they already
                  could.
                </span>
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteViewDialog({
  view,
  pending,
  onOpenChange,
  onConfirm,
}: {
  view: SavedFilterView | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={view !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Delete “${view?.name ?? ""}”?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {view?.shared
              ? "It disappears from everyone's Views menu. No deals change."
              : "Only the saved view is removed. No deals change."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              // Stay open until the delete lands; the parent closes it.
              e.preventDefault();
              onConfirm();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
