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
  telegramId: string | null;
  updateTelegramId: (formData: FormData) => Promise<void>;
  tenant: TenantProps;
  logoPreviewUrl: string | null;
  legacyRelativeLogo: boolean;
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
  zillowSources: Array<{
    id: string;
    profileUrl: string;
    displayLabel: string | null;
    assignedUserId: string | null;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  }>;
  tenantUsers: Array<{ id: string; name: string | null; email: string }>;
  addZillowProfile: (formData: FormData) => Promise<void>;
  removeZillowProfile: (formData: FormData) => Promise<void>;
  syncZillowProfile: (formData: FormData) => Promise<void>;
};

export function SettingsForms({
  telegramId,
  updateTelegramId,
  tenant,
  logoPreviewUrl,
  legacyRelativeLogo,
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
  zillowSources,
  tenantUsers,
  addZillowProfile,
  removeZillowProfile,
  syncZillowProfile,
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
          Stored in the database so it survives deploys (PNG/JPEG/WebP/GIF, max ~400KB). Re-upload after changing
          hosts if an old path stopped working.
        </p>
        {legacyRelativeLogo && (
          <p className="mt-3 rounded-md border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-sm text-[var(--amber)]">
            Previous logo used a server file path that is no longer available (common after moving to Railway).
            Upload again to fix the header.
          </p>
        )}
        {logoPreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoPreviewUrl} alt="" className="mt-4 h-14 w-auto object-contain" />
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
          Paste the <strong className="text-[var(--txt)]">folder ID</strong> of the Drive folder that contains listing
          photo subfolders. Use the ID from the URL after <code className="text-[var(--teal)]">folders/</code>. Share
          that folder with the Google account you use to sign in so Drive APIs can read it.
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
        <h2 className="font-display text-lg text-[var(--gold)]">Zillow · listing import (experimental)</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--txt2)]">
          Add public <strong className="text-[var(--txt)]">zillow.com</strong> profile or team URLs (broker page, agent
          page, etc.). <strong className="text-[var(--txt)]">Sync</strong> fetches HTML and tries to extract listing
          links — Zillow changes pages often, so results vary. <strong className="text-[var(--txt)]">HTTP 403</strong>{" "}
          from this app on Railway is common (Zillow blocks many datacenter IPs). Respect Zillow&apos;s terms; treat
          this as experimental — Drive or manual URLs are more reliable.
        </p>
        {disabledNote && <p className="mt-2 text-sm text-[var(--amber)]">{disabledNote}</p>}

        {canEdit && (
          <form action={addZillowProfile} className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Profile URL</label>
              <input
                name="profileUrl"
                required
                type="url"
                placeholder="https://www.zillow.com/profile/YourName"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Label (optional)</label>
              <input
                name="displayLabel"
                type="text"
                placeholder="Jane · team page"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
                Assign to agent (optional)
              </label>
              <select
                name="assignedUserId"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
                defaultValue=""
              >
                <option value="">— None —</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.name ?? u.email).trim()} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-[var(--teal)]/20 px-4 py-2 text-sm font-semibold text-[var(--teal)]"
              >
                Add Zillow page
              </button>
            </div>
          </form>
        )}

        <ul className="mt-6 space-y-4">
          {zillowSources.length === 0 ? (
            <li className="text-sm text-[var(--txt3)]">No Zillow pages yet.</li>
          ) : (
            zillowSources.map((z) => (
              <li
                key={z.id}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--txt2)]"
              >
                <div className="font-medium text-[var(--txt)]">{z.displayLabel ?? "Zillow page"}</div>
                <a
                  href={z.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block break-all text-xs text-[var(--teal)] hover:underline"
                >
                  {z.profileUrl}
                </a>
                {z.assignedUserId && (
                  <p className="mt-1 text-xs text-[var(--txt3)]">
                    Assigned:{" "}
                    {tenantUsers.find((u) => u.id === z.assignedUserId)?.email ?? z.assignedUserId}
                  </p>
                )}
                <p className="mt-2 text-xs text-[var(--txt3)]">
                  {z.lastSyncedAt
                    ? `Last sync: ${z.lastSyncedAt.toLocaleString()}`
                    : "Never synced"}
                  {z.lastSyncError && (
                    <span className="mt-1 block text-[var(--coral)]">Error: {z.lastSyncError}</span>
                  )}
                </p>
                {canEdit && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={syncZillowProfile}>
                      <input type="hidden" name="id" value={z.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--txt)]"
                      >
                        Sync listings
                      </button>
                    </form>
                    <form action={removeZillowProfile}>
                      <input type="hidden" name="id" value={z.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--coral)]/50 px-3 py-1.5 text-xs text-[var(--coral)]"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 lg:col-span-2">
        <h2 className="font-display text-lg text-[var(--gold)]">Telegram</h2>
        <p className="mt-1 text-sm text-[var(--txt3)]">
          Link your Telegram account so the RE Agent OS bot can recognize you. Open Telegram,
          message <code className="text-[var(--teal)]">@userinfobot</code> and paste the numeric ID below.
        </p>
        <form action={wrap(updateTelegramId)} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Telegram User ID
            </label>
            <input
              name="telegramId"
              defaultValue={telegramId ?? ""}
              placeholder="e.g. 123456789"
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--txt)]"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-md bg-[var(--teal)]/20 px-4 py-2 text-sm font-semibold text-[var(--teal)] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save Telegram ID"}
          </button>
        </form>
        <p className="mt-3 text-xs text-[var(--txt3)]">
          Clear the field and save to unlink.
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
