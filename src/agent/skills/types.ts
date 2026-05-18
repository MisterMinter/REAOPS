export type ToolContext = {
  userId: string;
  accessToken: string | null;
  tenantId: string | null;
  driveRootFolderId: string | null;
  defaultTone: string;
  flyerNotifyEmail: string | null;
  brokerPhone: string | null;
};
