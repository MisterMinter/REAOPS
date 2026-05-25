"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketingListingSource } from "@/lib/marketing-listings";
import {
  MARKETING_OUTPUT_DELIMITER,
  type ListingFacts,
  parseMarketingPackResponse,
} from "@/lib/marketing-generate";

export type MarketingWorkspaceRow = {
  key: string;
  title: string;
  source: MarketingListingSource;
  driveFolderId: string | null;
  cachedListingId: string | null;
  facts: ListingFacts;
};

export type MarketingCampaignWorkspace = {
  id: string;
  title: string;
  status: string;
  sourceListingKey: string | null;
  cachedListingId: string | null;
  summary: string | null;
  recommendedHero: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    stage: string;
    channel: string;
    title: string;
    content: string | null;
    status: string;
    dueAt: string | null;
    asset: {
      id: string;
      type: string;
      title: string;
      content: string | null;
    } | null;
  }>;
};

type BrandKit = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontStyle: string;
  slogan: string;
  disclaimer: string;
};

type DriveFile = {
  id?: string | null;
  name?: string | null;
  thumbnailLink?: string | null;
  mimeType?: string | null;
};

type ProviderKey = "gemini" | "anthropic" | "openai";

function sourceBadge(source: MarketingListingSource) {
  const map: Record<MarketingListingSource, string> = {
    hubspot: "HubSpot",
    drive: "Drive",
    both: "HubSpot + Drive",
    mls: "MLS",
    mls_drive: "MLS + Drive",
    zillow: "Zillow fallback",
    zillow_drive: "Zillow fallback + Drive",
  };
  return map[source];
}

function emptyFacts(title: string): ListingFacts {
  return {
    address: title,
    city: "",
    state: "",
    zip: "",
    beds: null,
    baths: null,
    sqft: null,
    priceDisplay: "—",
    features: "",
    status: "Active",
    daysOnMarket: null,
  };
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          setOk(false);
        }
      }}
      className="rounded border border-[var(--border2)] px-2 py-1 text-xs text-[var(--teal)] hover:bg-[var(--teal)]/10 disabled:opacity-40"
    >
      {ok ? "Copied" : label}
    </button>
  );
}

function serializeCampaign(raw: unknown): MarketingCampaignWorkspace {
  const campaign = raw as MarketingCampaignWorkspace;
  return {
    ...campaign,
    createdAt: String(campaign.createdAt),
    items: (campaign.items ?? []).map((item) => ({
      ...item,
      dueAt: item.dueAt ? String(item.dueAt) : null,
    })),
  };
}

function dateLabel(value: string | null) {
  if (!value) return "No date";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MarketingPackWorkspace({
  listings,
  defaultTone,
  brandKit,
  initialCampaigns,
}: {
  listings: MarketingWorkspaceRow[];
  defaultTone: string;
  brandKit: BrandKit;
  initialCampaigns: MarketingCampaignWorkspace[];
}) {
  const [selectedKey, setSelectedKey] = useState(listings[0]?.key ?? "");
  const selected = useMemo(
    () => listings.find((l) => l.key === selectedKey) ?? null,
    [listings, selectedKey]
  );

  const [draftFacts, setDraftFacts] = useState<ListingFacts>(() =>
    selected ? { ...selected.facts } : emptyFacts("")
  );

  useEffect(() => {
    if (selected) setDraftFacts({ ...selected.facts });
  }, [selected]);

  const [photos, setPhotos] = useState<DriveFile[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [heroId, setHeroId] = useState<string | null>(null);

  const folderId = selected?.driveFolderId ?? null;

  useEffect(() => {
    setPhotos([]);
    setHeroId(null);
    setPhotosError(null);
    if (!folderId) return;

    let cancelled = false;
    setPhotosLoading(true);
    fetch(`/api/drive/photos?folderId=${encodeURIComponent(folderId)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.hint ?? j.error ?? r.statusText);
        return j.files as DriveFile[];
      })
      .then((files) => {
        if (cancelled) return;
        setPhotos(Array.isArray(files) ? files : []);
        const first = files?.[0];
        if (first?.id) setHeroId(first.id);
      })
      .catch((e) => {
        if (!cancelled) setPhotosError(e instanceof Error ? e.message : "Failed to load photos");
      })
      .finally(() => {
        if (!cancelled) setPhotosLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [folderId, selectedKey]);

  const hero = photos.find((p) => p.id === heroId) ?? photos[0];

  const [provider, setProvider] = useState<ProviderKey | "">("");
  const [providers, setProviders] = useState<Partial<Record<ProviderKey, boolean>>>({});

  useEffect(() => {
    fetch("/api/assistant/config")
      .then((r) => r.json())
      .then((d: { providers?: Partial<Record<ProviderKey, boolean>>; defaultProvider?: ProviderKey | null }) => {
        setProviders(d.providers ?? {});
        if (d.defaultProvider) setProvider(d.defaultProvider);
      })
      .catch(() => {});
  }, []);

  const aiReady = Object.values(providers).some(Boolean);

  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [mls, setMls] = useState("");
  const [instagram, setInstagram] = useState("");
  const [emailSubjects, setEmailSubjects] = useState("");
  const [cardBlurb, setCardBlurb] = useState("");

  const [flyerBusy, setFlyerBusy] = useState(false);
  const [flyerResult, setFlyerResult] = useState<{
    success?: boolean;
    headline?: string;
    templateStyle?: string;
    pdfDriveUrl?: string | null;
    pngDriveUrl?: string | null;
    savedToDrive?: boolean;
    emailSent?: boolean;
    emailTo?: string;
    emailError?: string;
    error?: string;
  } | null>(null);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchGoal, setLaunchGoal] = useState("listing_launch");
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const selectedCampaigns = useMemo(() => {
    if (!selected) return [];
    return campaigns.filter(
      (campaign) =>
        campaign.sourceListingKey === selected.key ||
        (selected.cachedListingId && campaign.cachedListingId === selected.cachedListingId)
    );
  }, [campaigns, selected]);

  const runGenerate = useCallback(async () => {
    if (!aiReady || !selected) return;
    setGenerating(true);
    setStreamText("");
    setMls("");
    setInstagram("");
    setEmailSubjects("");
    setCardBlurb("");

    const heroContext = hero?.name
      ? `Agent selected hero image file name: ${hero.name}${hero.id ? ` (id ${hero.id})` : ""}`
      : "No hero image selected; write generically.";

    try {
      const res = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultTone,
          facts: draftFacts,
          heroContext,
          provider: provider || undefined,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMls(j.error ?? res.statusText);
        setGenerating(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMls("No response stream.");
        setGenerating(false);
        return;
      }

      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setStreamText(acc);
      }

      const parsed = parseMarketingPackResponse(acc);
      if (!acc.includes(MARKETING_OUTPUT_DELIMITER)) {
        setMls(acc.trim());
      } else {
        setMls(parsed.mls);
        setInstagram(parsed.instagram);
        setEmailSubjects(parsed.emailSubjects);
        setCardBlurb(parsed.cardBlurb);
        void fetch("/api/marketing/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Marketing pack - ${draftFacts.address}`,
            type: "MLS_COPY",
            content: [
              `MLS:\n${parsed.mls}`,
              `Instagram:\n${parsed.instagram}`,
              `Email subjects:\n${parsed.emailSubjects}`,
              `Card line:\n${parsed.cardBlurb}`,
            ].join("\n\n---\n\n"),
            metadata: {
              address: draftFacts.address,
              cachedListingId: selected.cachedListingId,
              source: selected.source,
            },
          }),
        }).catch(() => {});
      }
      setStreamText("");
    } catch (e) {
      setMls(e instanceof Error ? e.message : "Request failed");
    } finally {
      setGenerating(false);
    }
  }, [aiReady, selected, draftFacts, defaultTone, hero, provider]);

  const runFlyer = useCallback(
    async (action: "create" | "email") => {
      if (!selected) return;
      setFlyerBusy(true);
      setFlyerResult(null);
      try {
        const payload: Record<string, unknown> = {
          action,
          driveFolderId: selected.driveFolderId,
          address: draftFacts.address,
          city: draftFacts.city,
          state: draftFacts.state,
          zip: draftFacts.zip,
          beds: draftFacts.beds,
          baths: draftFacts.baths,
          sqft: draftFacts.sqft,
          priceDisplay: draftFacts.priceDisplay,
          features: draftFacts.features,
        };
        if (selected.cachedListingId) payload.listingId = selected.cachedListingId;

        const res = await fetch("/api/flyer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        setFlyerResult(json);
      } catch (e) {
        setFlyerResult({ error: e instanceof Error ? e.message : "Request failed" });
      } finally {
        setFlyerBusy(false);
      }
    },
    [selected, draftFacts]
  );

  const runLaunchPack = useCallback(async () => {
    if (!selected) return;
    setLaunchBusy(true);
    setLaunchError(null);
    const heroContext = hero?.name
      ? `Selected hero image: ${hero.name}${hero.id ? ` (Drive file ${hero.id})` : ""}`
      : "No hero selected.";

    try {
      const res = await fetch("/api/marketing/launch-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceListingKey: selected.key,
          cachedListingId: selected.cachedListingId,
          driveFolderId: selected.driveFolderId,
          facts: draftFacts,
          goal: launchGoal,
          heroContext,
          photoNames: photos
            .map((photo) => photo.name)
            .filter((name): name is string => Boolean(name)),
          provider: provider || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      if (json.campaign) {
        setCampaigns((current) => [serializeCampaign(json.campaign), ...current]);
      }
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Launch pack failed");
    } finally {
      setLaunchBusy(false);
    }
  }, [selected, hero, draftFacts, launchGoal, photos, provider]);

  if (listings.length === 0) {
    return (
      <p className="text-sm text-[var(--txt2)]">
        Add a Drive root in Settings or sync MLS listings — then pick a property here.
      </p>
    );
  }

  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:items-start">
      <div className="space-y-6">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Property</label>
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
          >
            {listings.map((l) => (
              <option key={l.key} value={l.key}>
                {l.title} · {sourceBadge(l.source)}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-[var(--gold)]/40 bg-[var(--card)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-lg text-[var(--gold)]">Listing Launch Pack</h3>
              <p className="mt-1 max-w-xl text-sm text-[var(--txt2)]">
                Create the full campaign: MLS remarks, social feed and story copy, carousel text, email blast, open
                house push, buyer follow-up script, seller update, and a dated execution timeline.
              </p>
            </div>
            <div className="flex gap-2">
              <span
                className="inline-block h-5 w-5 rounded-full border border-[var(--border)]"
                style={{ background: brandKit.primaryColor }}
              />
              <span
                className="inline-block h-5 w-5 rounded-full border border-[var(--border)]"
                style={{ background: brandKit.accentColor }}
              />
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <select
              value={launchGoal}
              onChange={(e) => setLaunchGoal(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="listing_launch">Launch this listing</option>
              <option value="open_house">Promote an open house</option>
              <option value="price_improvement">Price improvement push</option>
              <option value="stale_listing_recovery">Recover a stale listing</option>
            </select>
            <button
              type="button"
              disabled={launchBusy || !selected}
              onClick={() => void runLaunchPack()}
              className="rounded-md bg-[var(--gold)] px-5 py-2 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
            >
              {launchBusy ? "Building…" : "Build launch pack"}
            </button>
          </div>
          <div className="mt-3 text-xs text-[var(--txt3)]">
            Brand style: {brandKit.fontStyle}
            {brandKit.slogan ? ` · ${brandKit.slogan}` : ""}
          </div>
          {launchError && <p className="mt-3 text-sm text-[var(--coral)]">{launchError}</p>}
        </div>

        {selectedCampaigns.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-lg text-[var(--gold)]">Campaign Timeline</h3>
              <span className="text-xs text-[var(--txt3)]">{selectedCampaigns.length} pack(s)</span>
            </div>
            <div className="mt-4 space-y-5">
              {selectedCampaigns.map((campaign) => (
                <div key={campaign.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-[var(--txt)]">{campaign.title}</div>
                      <div className="mt-1 text-xs text-[var(--txt3)]">
                        {campaign.status} · created {dateLabel(campaign.createdAt)}
                      </div>
                    </div>
                    <span className="rounded-full border border-[var(--border2)] px-2 py-1 text-xs text-[var(--teal)]">
                      {campaign.items.length} actions
                    </span>
                  </div>
                  {campaign.summary && <p className="mt-3 text-sm text-[var(--txt2)]">{campaign.summary}</p>}
                  {campaign.recommendedHero && (
                    <p className="mt-2 text-xs text-[var(--txt3)]">Hero recommendation: {campaign.recommendedHero}</p>
                  )}
                  <div className="mt-4 space-y-3">
                    {campaign.items.map((item) => (
                      <details key={item.id} className="rounded border border-[var(--border)] bg-[var(--card)] p-3">
                        <summary className="cursor-pointer text-sm text-[var(--txt)]">
                          <span className="font-medium">{item.title}</span>
                          <span className="text-[var(--txt3)]">
                            {" "}
                            · {item.stage} · {dateLabel(item.dueAt)}
                          </span>
                        </summary>
                        {item.content && (
                          <div className="mt-3 whitespace-pre-wrap text-sm text-[var(--txt2)]">{item.content}</div>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-[var(--border2)] px-2 py-1 text-xs text-[var(--txt3)]">
                            {item.status}
                          </span>
                          <span className="rounded-full border border-[var(--border2)] px-2 py-1 text-xs text-[var(--txt3)]">
                            {item.channel}
                          </span>
                          {item.content && <CopyBtn text={item.content} label="Copy" />}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <h3 className="font-display text-lg text-[var(--gold)]">Listing facts</h3>
          <p className="mt-1 text-xs text-[var(--txt3)]">
            Pulled from MLS/CRM when available; edit freely for Drive-only folders or Zillow fallback rows before generating.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs text-[var(--txt3)]">Street address</span>
              <input
                value={draftFacts.address}
                onChange={(e) => setDraftFacts((f) => ({ ...f, address: e.target.value }))}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--txt3)]">City</span>
              <input
                value={draftFacts.city}
                onChange={(e) => setDraftFacts((f) => ({ ...f, city: e.target.value }))}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--txt3)]">State</span>
              <input
                value={draftFacts.state}
                onChange={(e) => setDraftFacts((f) => ({ ...f, state: e.target.value }))}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--txt3)]">ZIP</span>
              <input
                value={draftFacts.zip}
                onChange={(e) => setDraftFacts((f) => ({ ...f, zip: e.target.value }))}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--txt3)]">Price display</span>
              <input
                value={draftFacts.priceDisplay}
                onChange={(e) => setDraftFacts((f) => ({ ...f, priceDisplay: e.target.value }))}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--txt3)]">Beds</span>
              <input
                type="number"
                value={draftFacts.beds ?? ""}
                onChange={(e) =>
                  setDraftFacts((f) => ({
                    ...f,
                    beds: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--txt3)]">Baths</span>
              <input
                type="number"
                step="0.5"
                value={draftFacts.baths ?? ""}
                onChange={(e) =>
                  setDraftFacts((f) => ({
                    ...f,
                    baths: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--txt3)]">Sq ft</span>
              <input
                type="number"
                value={draftFacts.sqft ?? ""}
                onChange={(e) =>
                  setDraftFacts((f) => ({
                    ...f,
                    sqft: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--txt3)]">Status</span>
              <input
                value={draftFacts.status}
                onChange={(e) => setDraftFacts((f) => ({ ...f, status: e.target.value }))}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs text-[var(--txt3)]">Features / notes</span>
              <textarea
                rows={3}
                value={draftFacts.features}
                onChange={(e) => setDraftFacts((f) => ({ ...f, features: e.target.value }))}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <h3 className="font-display text-lg text-[var(--gold)]">Photos (Google Drive)</h3>
          {!folderId && (
            <p className="mt-2 text-sm text-[var(--amber)]">
              No Drive folder linked for this row. Use a listing that shows a folder ID, or link CRM listings to Drive
              later.
            </p>
          )}
          {folderId && photosLoading && <p className="mt-2 text-sm text-[var(--txt3)]">Loading photos…</p>}
          {photosError && (
            <p className="mt-2 text-sm text-[var(--coral)]">{photosError}</p>
          )}
          {folderId && !photosLoading && photos.length === 0 && !photosError && (
            <p className="mt-2 text-sm text-[var(--txt3)]">No images in this folder.</p>
          )}
          {photos.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((p) => (
                <button
                  key={p.id ?? p.name}
                  type="button"
                  onClick={() => p.id && setHeroId(p.id)}
                  className={`relative aspect-square overflow-hidden rounded-md border-2 ${
                    p.id === heroId ? "border-[var(--gold)]" : "border-transparent"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbnailLink ?? ""}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(ev) => {
                      (ev.target as HTMLImageElement).style.opacity = "0.2";
                    }}
                  />
                  {p.id === heroId && (
                    <span className="absolute bottom-1 left-1 rounded bg-[var(--gold)] px-1 text-[10px] font-bold text-[var(--bg)]">
                      Hero
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="text-xs text-[var(--txt3)]">AI provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderKey | "")}
              disabled={!aiReady}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
            >
              <option value="">Default (env)</option>
              {providers.gemini && <option value="gemini">Gemini</option>}
              {providers.anthropic && <option value="anthropic">Anthropic</option>}
              {providers.openai && <option value="openai">OpenAI</option>}
            </select>
          </div>
          <button
            type="button"
            disabled={!aiReady || generating}
            onClick={() => void runGenerate()}
            className="rounded-md bg-[var(--gold)] px-6 py-2.5 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate marketing pack"}
          </button>
        </div>
        {!aiReady && (
          <p className="text-sm text-[var(--amber)]">
            Add an API key on the server (see Assistant / <code className="text-[var(--teal)]">.env.example</code>) to
            enable generation.
          </p>
        )}
      </div>

      <div className="space-y-6">
        {(generating || streamText) && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Live stream</div>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-[var(--txt2)]">
              {streamText}
            </pre>
          </div>
        )}

        <OutputBlock
          title="MLS description"
          value={mls}
          onChange={setMls}
          copyLabel="Copy MLS"
        />
        <OutputBlock
          title="Instagram caption"
          value={instagram}
          onChange={setInstagram}
          copyLabel="Copy caption"
        />
        <OutputBlock
          title="Email subject lines"
          value={emailSubjects}
          onChange={setEmailSubjects}
          copyLabel="Copy subjects"
        />
        <OutputBlock
          title="Graphic card line"
          value={cardBlurb}
          onChange={setCardBlurb}
          copyLabel="Copy card line"
        />

        <div className="rounded-lg border border-[var(--border2)] bg-[#f8f9fb] p-5 text-[#1a1d26] shadow-lg">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#64748b]">Listing card preview</div>
          <div className="mt-4 overflow-hidden rounded-lg bg-white shadow-md">
            <div className="aspect-[4/3] bg-[#e2e8f0]">
              {hero?.thumbnailLink ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero.thumbnailLink} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[#94a3b8]">Hero photo</div>
              )}
            </div>
            <div className="space-y-2 p-4">
              <div className="font-serif text-xl font-semibold text-[#0f172a]">{draftFacts.address}</div>
              <div className="text-sm text-[#475569]">
                {draftFacts.city}
                {draftFacts.state ? `, ${draftFacts.state}` : ""} {draftFacts.zip}
              </div>
              <div className="text-sm text-[#64748b]">
                {draftFacts.beds != null ? `${draftFacts.beds} bd` : "—"} ·{" "}
                {draftFacts.baths != null ? `${draftFacts.baths} ba` : "—"} ·{" "}
                {draftFacts.sqft != null ? `${draftFacts.sqft.toLocaleString()} sqft` : "—"}
              </div>
              <div className="text-lg font-semibold text-[#c9a84c]">{draftFacts.priceDisplay}</div>
              <p className="border-t border-[#e2e8f0] pt-3 text-sm leading-relaxed text-[#334155]">
                {cardBlurb || "Generated card line appears here."}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <h3 className="font-display text-lg text-[var(--gold)]">Property flyer</h3>
          <p className="mt-1 text-xs text-[var(--txt3)]">
            AI generates copy and picks a style. PDF + PNG are saved to the Drive folder if linked.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={flyerBusy || !selected}
              onClick={() => void runFlyer("create")}
              className="rounded-md bg-[var(--gold)] px-5 py-2 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
            >
              {flyerBusy ? "Creating…" : "Create flyer"}
            </button>
            <button
              type="button"
              disabled={flyerBusy || !selected}
              onClick={() => void runFlyer("email")}
              className="rounded-md border border-[var(--gold)] px-5 py-2 text-sm font-semibold text-[var(--gold)] disabled:opacity-50"
            >
              {flyerBusy ? "Sending…" : "Create & email flyer"}
            </button>
          </div>
          {flyerResult && (
            <div className="mt-4 space-y-2 text-sm">
              {flyerResult.error && (
                <p className="text-[var(--coral)]">{flyerResult.error}</p>
              )}
              {flyerResult.success && (
                <>
                  <p className="text-[var(--green)]">
                    Flyer created — {flyerResult.templateStyle} style
                    {flyerResult.headline ? `: "${flyerResult.headline}"` : ""}
                  </p>
                  {flyerResult.savedToDrive && (
                    <div className="flex flex-wrap gap-3">
                      {flyerResult.pdfDriveUrl && (
                        <a
                          href={flyerResult.pdfDriveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--teal)] hover:underline"
                        >
                          Open PDF in Drive
                        </a>
                      )}
                      {flyerResult.pngDriveUrl && (
                        <a
                          href={flyerResult.pngDriveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--teal)] hover:underline"
                        >
                          Open PNG in Drive
                        </a>
                      )}
                    </div>
                  )}
                  {!flyerResult.savedToDrive && (
                    <p className="text-[var(--txt3)]">
                      No Drive folder linked — flyer was generated but not saved to Drive.
                    </p>
                  )}
                  {flyerResult.emailSent && (
                    <p className="text-[var(--green)]">
                      Email sent to {flyerResult.emailTo}
                    </p>
                  )}
                  {flyerResult.emailError && (
                    <p className="text-[var(--coral)]">{flyerResult.emailError}</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OutputBlock({
  title,
  value,
  onChange,
  copyLabel,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  copyLabel: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base text-[var(--gold)]">{title}</h3>
        <CopyBtn text={value} label={copyLabel} />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={title.includes("MLS") ? 12 : 5}
        className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)]"
        placeholder="Generated copy appears here…"
      />
    </div>
  );
}
