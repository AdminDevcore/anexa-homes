// Deal-level call recordings. Each recording is tagged via FileAsset.category =
// the group key, so the Welcome Call and QC Call stay in their own slots —
// separate from generic attachments. One recording per slot (replaceable).

export type CallGroup = "welcome_call" | "qc_call";

export const CALL_GROUPS: Record<CallGroup, { label: string }> = {
  welcome_call: { label: "Welcome Call" },
  qc_call: { label: "QC Call" },
};

export const CALL_GROUP_KEYS: CallGroup[] = ["welcome_call", "qc_call"];
