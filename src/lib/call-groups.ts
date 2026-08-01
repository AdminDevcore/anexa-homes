// Deal-level call recordings. Each recording is tagged via FileAsset.category =
// the group key, so the QC Call stays in its own slot — separate from generic
// attachments. One recording per slot (replaceable).

export type CallGroup = "qc_call";

export const CALL_GROUPS: Record<CallGroup, { label: string }> = {
  qc_call: { label: "QC Call" },
};

export const CALL_GROUP_KEYS: CallGroup[] = ["qc_call"];
