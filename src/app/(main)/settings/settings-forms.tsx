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
  brandKit: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontStyle: string;
    slogan: string;
    disclaimer: string;
  };
  hubspotListingObject: string;
  brokerPhone: string | null;
  flyerNotifyEmail: string | null;
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
  bufferProfiles: Array<{ id: string; service: string; username: string; default: boolean }>;
  selectedBufferProfileIds: string[];
  canEdit: boolean;
  readOnly: boolean;
  isAdmin: boolean;
  updateProfile: (formData: FormData) => Promise<void>;
  updateDrive: (formData: FormData) => Promise<void>;
  uploadLogo: (formData: FormData) => Promise<void>;
  mlsProviders: Array<{
    key: string;
    label: string;
    description: string;
    configHelp: string;
  }>;
  mlsConfigs: Array<{
    id: string;
    providerKey: string;
    label: string;
    region: string | null;
    enabled: boolean;
    status: string;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  }>;
  zillowSources: Array<{
    id: string;
    profileUrl: string;
    displayLabel: string | null;
    assignedUserId: string | null;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  }>;
  tenantUsers: Array<{ id: string; name: string | null; email: string }>;
  addMlsProvider: (formData: FormData) => Promise<void>;
  setMlsProviderEnabled: (formData: FormData) => Promise<void>;
  removeMlsProvider: (formData: FormData) => Promise<void>;
  syncMlsProvider: (formData: FormData) => Promise<void>;
  addZillowProfile: (formData: FormData) => Promise<void>;
  removeZillowProfile: (formData: FormData) => Promise<void>;
  syncZillowProfile: (formData: FormData) => Promise<void>;
  syncHubSpot: () => Promise<void>;
  disconnectHubSpot: () => Promise<void>;
  disconnectBuffer: () => Promise<void>;
  selectBufferProfiles: (formData: FormData) => Promise<void>;
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
  bufferProfiles,
  selectedBufferProfileIds,
  canEdit,
  readOnly,
  isAdmin,
  updateProfile,
  updateDrive,
  uploadLogo,
  mlsProviders,
  mlsConfigs,
  zillowSources,
  tenantUsers,
  addMlsProvider,
  setMlsProviderEnabled,
  removeMlsProvider,
  syncMlsProvider,
  addZillowProfile,
  removeZillowProfile,
  syncZillowProfile,
  syncHubSpot,
  disconnectHubSpot,
  disconnectBuffer,
  selectBufferProfiles,
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
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Broker phone number
            </label>
            <input
              name="brokerPhone"
              defaultValue={tenant.brokerPhone ?? ""}
              disabled={!canEdit}
              placeholder="(555) 123-4567"
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)] disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Flyer notification email
            </label>
            <input
              name="flyerNotifyEmail"
              type="email"
              defaultValue={tenant.flyerNotifyEmail ?? ""}
              disabled={!canEdit}
              placeholder="contracts@yourbrokerage.com"
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)] disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-[var(--txt3)]">
              Default email for flyer delivery. The agent will send flyers here unless told otherwise.
              Emails are sent from the signed-in user&apos;s Google account.
            </p>
          </div>
          <div className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
                Primary
              </label>
              <input
                name="brandPrimaryColor"
                type="color"
                defaultValue={tenant.brandKit.primaryColor}
                disabled={!canEdit}
                className="mt-1 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
                Secondary
              </label>
              <input
                name="brandSecondaryColor"
                type="color"
                defaultValue={tenant.brandKit.secondaryColor}
                disabled={!canEdit}
                className="mt-1 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
                Accent
              </label>
              <input
                name="brandAccentColor"
                type="color"
                defaultValue={tenant.brandKit.accentColor}
                disabled={!canEdit}
                className="mt-1 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 disabled:opacity-50"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Brand style
            </label>
            <input
              name="brandFontStyle"
              defaultValue={tenant.brandKit.fontStyle}
              disabled={!canEdit}
              placeholder="Modern editorial, luxury serif, clean brokerage"
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)] disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Slogan / positioning line
            </label>
            <input
              name="brandSlogan"
              defaultValue={tenant.brandKit.slogan}
              disabled={!canEdit}
              placeholder="Local expertise. Calm execution."
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)] disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
              Marketing disclaimer
            </label>
            <textarea
              name="brandDisclaimer"
              rows={2}
              defaultValue={tenant.brandKit.disclaimer}
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
        <h2 className="font-display text-lg text-[var(--gold)]">MLS provider feeds</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--txt2)]">
          MLS should be the primary listing source for brokerage facts. Add one provider per market or board, then use
          Zillow only as a best-effort fallback when MLS, CRM, and Drive do not have a listing yet.
        </p>
        {disabledNote && <p className="mt-2 text-sm text-[var(--amber)]">{disabledNote}</p>}

        {canEdit && (
          <form action={addMlsProvider} className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Provider</label>
              <select
                name="providerKey"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
                defaultValue={mlsProviders[0]?.key ?? ""}
                required
              >
                {mlsProviders.map((provider) => (
                  <option key={provider.key} value={provider.key}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Label</label>
              <input
                name="label"
                placeholder="GA MLS · Atlanta"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Region / market</label>
              <input
                name="region"
                placeholder="Atlanta, GA"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Endpoint / base URL</label>
              <input
                name="baseUrl"
                type="url"
                placeholder="https://mls.example.com/reso/odata/Property"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">OData query</label>
              <input
                name="query"
                placeholder="$filter=StandardStatus eq 'Active'&$top=100"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">API token / secret</label>
              <input
                name="secret"
                type="password"
                placeholder="Stored encrypted"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
                Manual listings JSON
              </label>
              <textarea
                name="manualListings"
                rows={4}
                placeholder='[{"externalId":"A123","address":"123 Main St","city":"Atlanta","state":"GA","price":500000,"beds":3,"baths":2}]'
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--txt)]"
              />
              <p className="mt-1 text-xs text-[var(--txt3)]">
                Use Manual JSON for exports while a board-specific provider adapter is being added. Generic RESO uses
                endpoint, query, and token fields.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input id="mls-enabled" name="enabled" type="checkbox" defaultChecked />
              <label htmlFor="mls-enabled" className="text-sm text-[var(--txt2)]">Enabled for scheduled sync</label>
            </div>
            <div className="md:text-right">
              <button
                type="submit"
                className="rounded-md bg-[var(--teal)]/20 px-4 py-2 text-sm font-semibold text-[var(--teal)]"
              >
                Add MLS provider
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {mlsProviders.map((provider) => (
            <div key={provider.key} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
              <div className="font-medium text-[var(--txt)]">{provider.label}</div>
              <p className="mt-1 text-xs text-[var(--txt3)]">{provider.description}</p>
              <p className="mt-2 text-xs text-[var(--txt2)]">{provider.configHelp}</p>
            </div>
          ))}
        </div>

        <ul className="mt-6 space-y-4">
          {mlsConfigs.length === 0 ? (
            <li className="text-sm text-[var(--txt3)]">No MLS providers configured yet.</li>
          ) : (
            mlsConfigs.map((config) => (
              <li
                key={config.id}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--txt2)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-[var(--txt)]">{config.label}</div>
                    <p className="mt-1 text-xs text-[var(--txt3)]">
                      {config.providerKey}
                      {config.region ? ` · ${config.region}` : ""} · {config.enabled ? "enabled" : "disabled"} ·{" "}
                      {config.status}
                    </p>
                  </div>
                  <span className={config.enabled ? "text-xs font-semibold text-[var(--green)]" : "text-xs text-[var(--txt3)]"}>
                    {config.enabled ? "Primary feed" : "Paused"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--txt3)]">
                  {config.lastSyncedAt
                    ? `Last sync: ${config.lastSyncedAt.toLocaleString()}`
                    : "Never synced"}
                  {config.lastSyncError && (
                    <span className="mt-1 block text-[var(--coral)]">Error: {config.lastSyncError}</span>
                  )}
                </p>
                {canEdit && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={syncMlsProvider}>
                      <input type="hidden" name="id" value={config.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--txt)]"
                      >
                        Sync now
                      </button>
                    </form>
                    <form action={setMlsProviderEnabled}>
                      <input type="hidden" name="id" value={config.id} />
                      <input type="hidden" name="enabled" value={config.enabled ? "false" : "true"} />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--txt2)]"
                      >
                        {config.enabled ? "Pause" : "Enable"}
                      </button>
                    </form>
                    <form action={removeMlsProvider}>
                      <input type="hidden" name="id" value={config.id} />
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
        <h2 className="font-display text-lg text-[var(--gold)]">Zillow fallback import</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--txt2)]">
          Add public <strong className="text-[var(--txt)]">zillow.com</strong> profile or team URLs (broker page, agent
          page, etc.). <strong className="text-[var(--txt)]">Sync</strong> fetches HTML and tries to extract listing
          links — Zillow changes pages often, so results vary. <strong className="text-[var(--txt)]">HTTP 403</strong>{" "}
          from this app on Railway is common (Zillow blocks many datacenter IPs). Respect Zillow&apos;s terms; treat
          this as fallback only after MLS, CRM, or Drive cannot provide the listing.
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
              Connect once per brokerage, then sync contacts and listing/deal records into REAOPS.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {hubspotConnected ? (
                <>
                  <form action={() => startTransition(() => syncHubSpot())}>
                    <button
                      type="submit"
                      disabled={pending || !canEdit}
                      className="rounded-md bg-[var(--teal)]/20 px-3 py-2 text-xs font-semibold text-[var(--teal)] disabled:opacity-50"
                    >
                      {pending ? "Syncing…" : "Sync now"}
                    </button>
                  </form>
                  <form action={() => startTransition(() => disconnectHubSpot())}>
                    <button
                      type="submit"
                      disabled={pending || !canEdit}
                      className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--txt2)] disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </form>
                </>
              ) : (
                <Link
                  href="/api/hubspot/connect"
                  aria-disabled={!canEdit}
                  className={`rounded-md bg-[var(--teal)]/20 px-3 py-2 text-xs font-semibold text-[var(--teal)] ${
                    canEdit ? "" : "pointer-events-none opacity-50"
                  }`}
                >
                  Connect HubSpot
                </Link>
              )}
            </div>
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
            <div className="mt-3 flex flex-wrap gap-2">
              {!bufferConnected ? (
                <Link
                  href="/api/buffer/connect"
                  aria-disabled={!canEdit}
                  className={`rounded-md bg-[var(--teal)]/20 px-3 py-2 text-xs font-semibold text-[var(--teal)] ${
                    canEdit ? "" : "pointer-events-none opacity-50"
                  }`}
                >
                  Connect Buffer
                </Link>
              ) : (
                <form action={disconnectBuffer}>
                  <button
                    disabled={!canEdit}
                    className="rounded-md border border-[var(--border2)] px-3 py-2 text-xs font-semibold text-[var(--txt2)] disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </form>
              )}
            </div>
            {bufferConnected && bufferProfiles.length > 0 && (
              <form action={selectBufferProfiles} className="mt-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Profiles</div>
                {bufferProfiles.map((profile) => (
                  <label key={profile.id} className="flex items-center gap-2 text-xs text-[var(--txt2)]">
                    <input
                      type="checkbox"
                      name="profileIds"
                      value={profile.id}
                      defaultChecked={
                        selectedBufferProfileIds.length > 0
                          ? selectedBufferProfileIds.includes(profile.id)
                          : profile.default
                      }
                      disabled={!canEdit}
                    />
                    <span>
                      {profile.service} · {profile.username}
                    </span>
                  </label>
                ))}
                <button
                  disabled={!canEdit}
                  className="rounded-md bg-[var(--teal)]/20 px-3 py-2 text-xs font-semibold text-[var(--teal)] disabled:opacity-50"
                >
                  Save profiles
                </button>
              </form>
            )}
            {bufferConnected && bufferProfiles.length === 0 && (
              <p className="mt-3 text-xs text-[var(--amber)]">Connected, but no Buffer profiles were returned.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
