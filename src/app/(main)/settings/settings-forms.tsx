"use client";

import Link from "next/link";
import { useTransition } from "react";

type TenantProps = {
  id: string;
  name: string;
  slug: string;
  brokerageName: string | null;
  defaultTone: string;
  logoUrl: string | null;
  hubspotListingObject: string;
};

type Props = {
  tenant: TenantProps;
  driveRootFolderId: string;
  hubspotConnected: boolean;
  hubspotHubId: string | null;
  hubspotUpdatedAt: Date | null;
  bufferConnected: boolean;
  bufferUpdatedAt: Date | null;
  canEdit: boolean;
  readOnly: boolean;
  isAdmin: boolean;
  updateProfile: (formData: FormData) => Promise<void>;
  updateDrive: (formData: FormData) => Promise<void>;
  uploadLogo: (formData: FormData) => Promise<void>;
};

export function SettingsForms({
  tenant,
  driveRootFolderId,
  hubspotConnected,
  hubspotHubId,
  hubspotUpdatedAt,
  bufferConnected,
  bufferUpdatedAt,
  canEdit,
  readOnly,
  isAdmin,
  updateProfile,
  updateDrive,
  uploadLogo,
}: Props) {
  const [pending, startTransition] = useTransition();

  function wrap(action: (fd: FormData) => Promise<void>) {
    return (formData: FormData) => {
      startTransition(() => action(formData));
    };
  }

  const disabledNote = readOnly
    ? "Ask a broker owner to change these settings."
    : null;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="font-display text-lg text-[var(--gold)]">Brokerage profile</h2>
        <p className="mt-1 text-xs text-[var(--txt3)]">
          Internal name: <span className="text-[var(--txt2)]">{tenant.name}</span> · slug{" "}
          <code className="text-[var(--teal)]">{tenant.slug}</code>
        </p>
        {disabledNote && <p className="mt-2 text-sm text-[var(--amber)]">{disabledNote}</p>}
        <form action={wrap(updateProfile)} className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Public brokerage name
            </label>
            <input
              name="brokerageName"
              defaultValue={tenant.brokerageName ?? ""}
              disabled={!canEdit}
              placeholder={tenant.name}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)] disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Default marketing tone
            </label>
            <textarea
              name="defaultTone"
              rows={4}
              defaultValue={tenant.defaultTone}
              disabled={!canEdit}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)] disabled:opacity-50"
            />
          </div>
          {canEdit && (
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save profile"}
            </button>
          )}
        </form>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="font-display text-lg text-[var(--gold)]">Broker logo</h2>
        <p className="mt-1 text-sm text-[var(--txt3)]">
          Shown in the app header. Same storage as admin upload (GCS or local <code className="text-[var(--teal)]">/uploads</code>
          ).
        </p>
        {tenant.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logoUrl} alt="" className="mt-4 h-14 w-auto object-contain" />
        )}
        {canEdit ? (
          <form action={wrap(uploadLogo)} encType="multipart/form-data" className="mt-4 flex flex-wrap items-end gap-3">
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp,image/gif"
              required
              className="max-w-full text-sm text-[var(--txt2)]"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-[var(--border2)] px-3 py-2 text-sm text-[var(--txt)] disabled:opacity-50"
            >
              Upload
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-[var(--txt3)]">{disabledNote}</p>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 lg:col-span-2">
        <h2 className="font-display text-lg text-[var(--gold)]">Google Drive · listing photos</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--txt2)]">
          Paste the <strong className="text-[var(--txt)]">folder ID</strong> of the shared Drive folder that contains
          subfolders per listing (one folder per property). The ID is the long string in the folder URL after{" "}
          <code className="text-[var(--teal)]">folders/</code>. The service account for this app must have access to
          that folder.
        </p>
        {disabledNote && <p className="mt-2 text-sm text-[var(--amber)]">{disabledNote}</p>}
        <form action={wrap(updateDrive)} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Root folder ID
            </label>
            <input
              name="rootFolderId"
              defaultValue={driveRootFolderId}
              disabled={!canEdit}
              placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--txt)] disabled:opacity-50"
            />
          </div>
          {canEdit && (
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 rounded-md bg-[var(--teal)]/20 px-4 py-2 text-sm font-semibold text-[var(--teal)] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save Drive folder"}
            </button>
          )}
        </form>
        <p className="mt-3 text-xs text-[var(--txt3)]">
          Clear the field and save to remove the stored folder ID.
        </p>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 lg:col-span-2">
        <h2 className="font-display text-lg text-[var(--gold)]">Integrations</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--txt)]">HubSpot</span>
              <span
                className={
                  hubspotConnected ? "text-xs font-semibold text-[var(--green)]" : "text-xs text-[var(--txt3)]"
                }
              >
                {hubspotConnected ? "Connected" : "Not connected"}
              </span>
            </div>
            {hubspotConnected && hubspotHubId && (
              <p className="mt-2 text-xs text-[var(--txt3)]">
                Hub ID <code className="text-[var(--teal)]">{hubspotHubId}</code>
                {hubspotUpdatedAt && (
                  <> · updated {hubspotUpdatedAt.toLocaleString()}</>
                )}
              </p>
            )}
            <p className="mt-3 text-xs text-[var(--txt3)]">
              OAuth connect flow is not wired in this build yet. After it ships, you will connect here with one click.
            </p>
            {isAdmin && (
              <p className="mt-2 text-xs">
                <Link href={`/admin/tenants/${tenant.id}`} className="text-[var(--teal)] hover:underline">
                  HubSpot object &amp; field mapping (admin)
                </Link>
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--txt3)]">
              Listing object type: <code className="text-[var(--teal)]">{tenant.hubspotListingObject}</code>
            </p>
          </div>

          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--txt)]">Buffer</span>
              <span
                className={
                  bufferConnected ? "text-xs font-semibold text-[var(--green)]" : "text-xs text-[var(--txt3)]"
                }
              >
                {bufferConnected ? "Connected" : "Not connected"}
              </span>
            </div>
            {bufferConnected && bufferUpdatedAt && (
              <p className="mt-2 text-xs text-[var(--txt3)]">Updated {bufferUpdatedAt.toLocaleString()}</p>
            )}
            <p className="mt-3 text-xs text-[var(--txt3)]">
              Social scheduling will connect here. Until then, copy captions from the marketing workflow manually.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
