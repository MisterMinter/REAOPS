import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  addLeadSourceAction,
  addMlsProviderConfigAction,
  addSendingIdentityAction,
  addZillowProfileSource,
  checkBlueBubblesAction,
  configureBlueBubblesAction,
  disconnectBufferAction,
  removeZillowProfileSource,
  removeMlsProviderConfigAction,
  disconnectHubSpotAction,
  selectBufferProfilesAction,
  setMlsProviderEnabledAction,
  syncHubSpotAction,
  syncMlsProviderConfigAction,
  syncZillowProfileSourceAction,
  updateAgentLoopAction,
  updateAutomationPolicyAction,
  updateDriveRootFolder,
  updateTelegramId,
  updateTenantProfile,
  uploadTenantLogoFromSettings,
} from "@/app/(main)/settings/_actions";
import { SettingsForms } from "@/app/(main)/settings/settings-forms";
import { listBufferProfiles } from "@/lib/buffer";
import { listMlsProviders } from "@/lib/mls/registry";
import { parseBrandKit } from "@/lib/marketing/brand-kit";
import { ensureOpsDefaults } from "@/lib/ops/defaults";
import { hasLegacyRelativeLogoPath, resolveTenantLogoForDisplay } from "@/lib/tenant-logo";
import { ApprovalMode, ChannelKind, SendingIdentityType } from "@prisma/client";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    imported?: string;
    contacts?: string;
    listings?: string;
    detail?: string;
  }>;
}) {
  const q = await searchParams;
  const session = await auth();
  const user = session?.user;

  if (!user) {
    return null;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { telegramId: true },
  });

  const noTenant = !user.tenantId;
  const canEdit = user.role === "BROKER_OWNER" || user.role === "ADMIN";
  const readOnly = Boolean(user.tenantId && user.role === "AGENT");

  const tenant = user.tenantId
    ? await prisma.tenant.findUnique({
        where: { id: user.tenantId },
        include: {
          hubspotTokens: { select: { id: true, hubId: true, updatedAt: true } },
          bufferTokens: { select: { id: true, updatedAt: true, profileIds: true } },
          driveConfig: { select: { rootFolderId: true, updatedAt: true } },
          mlsProviderConfigs: { orderBy: [{ enabled: "desc" }, { createdAt: "asc" }] },
          zillowProfileSources: { orderBy: { createdAt: "asc" } },
        },
      })
    : null;

  const tenantUsers = user.tenantId
    ? await prisma.user.findMany({
        where: { tenantId: user.tenantId },
        select: { id: true, name: true, email: true },
        orderBy: { email: "asc" },
      })
    : [];

  if (user.tenantId) {
    await ensureOpsDefaults(prisma, user.tenantId);
  }

  const bufferProfiles = user.tenantId
    ? await listBufferProfiles({ prisma, tenantId: user.tenantId }).catch(() => [])
    : [];

  const opsConfig = user.tenantId
    ? await prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: {
          defaultApprovalMode: true,
          leadSources: { orderBy: { name: "asc" } },
          automationRules: { orderBy: { createdAt: "asc" } },
          sendingIdentities: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
          channelAccounts: { orderBy: { updatedAt: "desc" } },
          agentLoops: { orderBy: { kind: "asc" } },
        },
      })
    : null;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Settings</h1>
        <p className="mt-2 max-w-2xl text-[var(--txt2)]">
          Brokerage profile, MLS feeds, Google Drive listing photos folder, HubSpot sync, Buffer social profiles, and integration status.
        </p>
      </div>

      {noTenant && (
        <section className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/5 p-6">
          <h2 className="font-display text-xl text-[var(--amber)]">No brokerage assigned</h2>
          <p className="mt-2 text-sm text-[var(--txt2)]">
            Your account is not linked to a tenant yet. Platform admins should create a tenant under{" "}
            <Link href="/admin/tenants" className="text-[var(--teal)] hover:underline">
              Admin → Tenants
            </Link>
            , then add you as a user with that tenant and role{" "}
            <strong className="text-[var(--txt)]">Broker owner</strong> or{" "}
            <strong className="text-[var(--txt)]">Agent</strong>.
          </p>
          {user.role === "ADMIN" && (
            <ul className="mt-4 list-inside list-disc text-sm text-[var(--txt3)]">
              <li>Create the brokerage: Admin → Tenants → New tenant</li>
              <li>
                Add yourself (or the broker) under Admin → Users with the new tenant selected — not
                &quot;Admin (platform)&quot; if you need marketing &amp; assistant for that brokerage
              </li>
              <li>
                Optional: keep a separate platform admin login without <code className="text-[var(--teal)]">tenantId</code>{" "}
                for onboarding only
              </li>
            </ul>
          )}
        </section>
      )}

      {q.saved === "logo" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Logo saved.
        </p>
      )}
      {q.error === "logo-invalid" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Logo must be PNG, JPEG, WebP, or GIF and under ~400KB.
        </p>
      )}
      {q.error === "logo-no-file" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Choose an image file before uploading.
        </p>
      )}
      {q.saved === "zillow-add" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Zillow page added. Use <strong className="text-[var(--txt)]">Sync listings</strong> to import.
        </p>
      )}
      {q.saved === "zillow-remove" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Zillow page removed.
        </p>
      )}
      {q.saved === "zillow-sync" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Zillow sync finished. Imported {q.imported ?? "0"} listing link(s). Check Marketing.
        </p>
      )}
      {q.saved === "hubspot-connected" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          HubSpot connected. Imported {q.contacts ?? "0"} contact(s) and {q.listings ?? "0"} listing/deal record(s).
        </p>
      )}
      {q.saved === "hubspot-sync" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          HubSpot sync finished. Imported {q.contacts ?? "0"} contact(s) and {q.listings ?? "0"} listing/deal record(s).
        </p>
      )}
      {q.saved === "hubspot-disconnect" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          HubSpot disconnected for this brokerage.
        </p>
      )}
      {q.saved === "buffer-connected" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Buffer connected. Select the social profiles REAOPS can draft to.
        </p>
      )}
      {q.saved === "buffer-profiles" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Buffer profiles saved.
        </p>
      )}
      {q.saved === "buffer-disconnect" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Buffer disconnected for this brokerage.
        </p>
      )}
      {q.saved === "mls-add" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          MLS provider added. Sync it to load listing facts into Marketing.
        </p>
      )}
      {q.saved === "mls-update" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          MLS provider status updated.
        </p>
      )}
      {q.saved === "mls-remove" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          MLS provider removed.
        </p>
      )}
      {q.saved === "mls-sync" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          MLS sync finished. Imported {q.imported ?? "0"} listing(s).
        </p>
      )}
      {q.error === "zillow-url" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Enter a valid Zillow profile URL.
        </p>
      )}
      {q.error === "zillow-id" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Missing Zillow source id.
        </p>
      )}
      {q.error === "zillow-sync" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Zillow sync failed{q.detail ? `: ${decodeURIComponent(q.detail)}` : ""}. Imported {q.imported ?? "0"} before
          error.
        </p>
      )}
      {q.error?.startsWith("hubspot") && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          HubSpot error{q.detail ? `: ${decodeURIComponent(q.detail)}` : ""}.
        </p>
      )}
      {q.error?.startsWith("buffer") && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Buffer error{q.detail ? `: ${decodeURIComponent(q.detail)}` : ""}.
        </p>
      )}
      {q.error === "mls-provider" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Select a registered MLS provider.
        </p>
      )}
      {q.error === "mls-json" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Manual MLS listings must be a JSON array.
        </p>
      )}
      {q.error === "mls-id" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Missing MLS provider id.
        </p>
      )}
      {q.error === "mls-sync" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          MLS sync failed{q.detail ? `: ${decodeURIComponent(q.detail)}` : ""}.
          {q.imported ? ` Imported ${q.imported} before error.` : ""}
        </p>
      )}

      {tenant && (
        <SettingsForms
          telegramId={dbUser?.telegramId ?? null}
          updateTelegramId={updateTelegramId}
          tenant={{
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            brokerageName: tenant.brokerageName,
            defaultTone: tenant.defaultTone,
            logoUrl: tenant.logoUrl,
            brandKit: parseBrandKit(tenant.brandKit),
            hubspotListingObject: tenant.hubspotListingObject,
            brokerPhone: tenant.brokerPhone,
            flyerNotifyEmail: tenant.flyerNotifyEmail,
          }}
          logoPreviewUrl={resolveTenantLogoForDisplay(tenant.logoUrl)}
          legacyRelativeLogo={hasLegacyRelativeLogoPath(tenant.logoUrl)}
          driveRootFolderId={tenant.driveConfig?.rootFolderId ?? ""}
          hubspotConnected={!!tenant.hubspotTokens}
          hubspotHubId={tenant.hubspotTokens?.hubId ?? null}
          hubspotUpdatedAt={tenant.hubspotTokens?.updatedAt ?? null}
          bufferConnected={!!tenant.bufferTokens}
          bufferUpdatedAt={tenant.bufferTokens?.updatedAt ?? null}
          bufferProfiles={bufferProfiles}
          selectedBufferProfileIds={stringArrayFrom(tenant.bufferTokens?.profileIds)}
          canEdit={canEdit}
          readOnly={readOnly}
          isAdmin={user.role === "ADMIN"}
          updateProfile={updateTenantProfile}
          updateDrive={updateDriveRootFolder}
          uploadLogo={uploadTenantLogoFromSettings}
          mlsProviders={listMlsProviders().map(({ key, label, description, configHelp }) => ({
            key,
            label,
            description,
            configHelp,
          }))}
          mlsConfigs={tenant.mlsProviderConfigs.map((config) => ({
            id: config.id,
            providerKey: config.providerKey,
            label: config.label,
            region: config.region,
            enabled: config.enabled,
            status: config.status,
            lastSyncedAt: config.lastSyncedAt,
            lastSyncError: config.lastSyncError,
          }))}
          zillowSources={tenant.zillowProfileSources}
          tenantUsers={tenantUsers}
          addMlsProvider={addMlsProviderConfigAction}
          setMlsProviderEnabled={setMlsProviderEnabledAction}
          removeMlsProvider={removeMlsProviderConfigAction}
          syncMlsProvider={syncMlsProviderConfigAction}
          addZillowProfile={addZillowProfileSource}
          removeZillowProfile={removeZillowProfileSource}
          syncZillowProfile={syncZillowProfileSourceAction}
          syncHubSpot={syncHubSpotAction}
          disconnectHubSpot={disconnectHubSpotAction}
          disconnectBuffer={disconnectBufferAction}
          selectBufferProfiles={selectBufferProfilesAction}
        />
      )}

      {tenant && opsConfig && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="font-display text-xl text-[var(--gold)]">Operations OS configuration</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--txt2)]">
            Follow-up automation, lead sources, sending identities, and premium channel adapters. These settings drive
            both chat actions and the web UI.
          </p>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="font-medium text-[var(--txt)]">Approval policy</h3>
              <form action={updateAutomationPolicyAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
                    Default mode
                  </span>
                  <select
                    name="defaultApprovalMode"
                    defaultValue={opsConfig.defaultApprovalMode}
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                  >
                    {Object.values(ApprovalMode).map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </label>
                {canEdit && (
                  <button type="submit" className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]">
                    Save
                  </button>
                )}
              </form>
              <p className="mt-3 text-xs text-[var(--txt3)]">
                High-risk messages are still forced into approval by the workflow policy.
              </p>
            </div>

            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="font-medium text-[var(--txt)]">Lead sources</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {opsConfig.leadSources.map((source) => (
                  <span key={source.id} className="rounded-full border border-[var(--border2)] px-3 py-1 text-xs text-[var(--txt2)]">
                    {source.name}
                  </span>
                ))}
              </div>
              {canEdit && (
                <form action={addLeadSourceAction} className="mt-4 flex gap-2">
                  <input name="name" placeholder="New source" className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm" />
                  <button type="submit" className="rounded-md bg-[var(--teal)]/20 px-3 py-2 text-sm font-semibold text-[var(--teal)]">
                    Add
                  </button>
                </form>
              )}
            </div>

            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="font-medium text-[var(--txt)]">Sending identities</h3>
              <div className="mt-3 space-y-2">
                {opsConfig.sendingIdentities.length === 0 ? (
                  <p className="text-xs text-[var(--txt3)]">No identities configured yet.</p>
                ) : (
                  opsConfig.sendingIdentities.map((identity) => (
                    <div key={identity.id} className="rounded border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
                      <div className="text-[var(--txt)]">
                        {identity.displayName} {identity.isDefault ? <span className="text-xs text-[var(--gold)]">default</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-[var(--txt3)]">
                        {identity.channel} · {identity.type} · {identity.email || identity.phone || "no address"}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {canEdit && (
                <form action={addSendingIdentityAction} className="mt-4 grid gap-2 sm:grid-cols-2">
                  <input name="displayName" placeholder="Shared Ops" className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm sm:col-span-2" />
                  <select name="channel" defaultValue={ChannelKind.GMAIL} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
                    {Object.values(ChannelKind).map((channel) => (
                      <option key={channel} value={channel}>{channel}</option>
                    ))}
                  </select>
                  <select name="type" defaultValue={SendingIdentityType.SHARED_OPS} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
                    {Object.values(SendingIdentityType).map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <input name="email" placeholder="Email" className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm" />
                  <input name="phone" placeholder="Phone/iMessage" className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm" />
                  <label className="flex items-center gap-2 text-xs text-[var(--txt2)]">
                    <input type="checkbox" name="isDefault" /> Default
                  </label>
                  <button type="submit" className="rounded-md bg-[var(--teal)]/20 px-3 py-2 text-sm font-semibold text-[var(--teal)]">
                    Add identity
                  </button>
                </form>
              )}
            </div>

            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="font-medium text-[var(--txt)]">BlueBubbles iMessage adapter</h3>
              {opsConfig.channelAccounts
                .filter((account) => account.kind === ChannelKind.BLUEBUBBLES)
                .map((account) => (
                  <p key={account.id} className="mt-2 text-xs text-[var(--txt3)]">
                    {account.label}: <span className="text-[var(--txt2)]">{account.status}</span>
                    {account.lastError ? <span className="block text-[var(--coral)]">{account.lastError}</span> : null}
                  </p>
                ))}
              {canEdit && (
                <>
                  <form action={configureBlueBubblesAction} className="mt-4 grid gap-2">
                    <input name="label" placeholder="BlueBubbles Mac mini" className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm" />
                    <input name="baseUrl" placeholder="https://bluebubbles.example.com" className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm" />
                    <input name="password" placeholder="API password" type="password" className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm" />
                    <button type="submit" className="rounded-md bg-[var(--teal)]/20 px-3 py-2 text-sm font-semibold text-[var(--teal)]">
                      Save BlueBubbles
                    </button>
                  </form>
                  <form action={checkBlueBubblesAction} className="mt-2">
                    <button type="submit" className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--txt2)]">
                      Health check
                    </button>
                  </form>
                </>
              )}
            </div>

            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-2">
              <h3 className="font-medium text-[var(--txt)]">Always-on agent loops</h3>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {opsConfig.agentLoops.map((loop) => (
                  <form key={loop.id} action={updateAgentLoopAction} className="rounded border border-[var(--border)] bg-[var(--card)] p-3">
                    <input type="hidden" name="id" value={loop.id} />
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-[var(--txt)]">{loop.name}</div>
                        <div className="mt-1 text-xs text-[var(--txt3)]">
                          {loop.kind} · last run {loop.lastRunAt ? loop.lastRunAt.toLocaleString() : "never"}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-[var(--txt2)]">
                        <input type="checkbox" name="enabled" defaultChecked={loop.enabled} disabled={!canEdit} />
                        Enabled
                      </label>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                      <input
                        name="cadence"
                        defaultValue={loop.cadence}
                        disabled={!canEdit}
                        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                      />
                      <input
                        name="persona"
                        defaultValue={loop.persona ?? ""}
                        placeholder="Persona"
                        disabled={!canEdit}
                        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                      />
                      {canEdit && (
                        <button type="submit" className="rounded-md bg-[var(--teal)]/20 px-3 py-2 text-sm font-semibold text-[var(--teal)]">
                          Save
                        </button>
                      )}
                    </div>
                  </form>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {tenant && user.role === "ADMIN" && (
        <p className="text-sm text-[var(--txt3)]">
          HubSpot field mapping and full tenant record:{" "}
          <Link href={`/admin/tenants/${tenant.id}`} className="text-[var(--teal)] hover:underline">
            Admin → Tenants → {tenant.name}
          </Link>
        </p>
      )}
    </div>
  );
}

function stringArrayFrom(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}
