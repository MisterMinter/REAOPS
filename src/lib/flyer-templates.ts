export type FlyerData = {
  templateStyle: "modern" | "luxury" | "bold";
  accentColor: string;
  headline: string;
  tagline: string;
  featureBullets: string[];
  ctaText: string;
  heroImageBase64: string | null;
  heroImageMimeType: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  priceDisplay: string;
  brokerName: string;
  brokerLogo: string | null;
  brokerPhone: string;
  brokerEmail: string;
};

const TEMPLATE_MAP: Record<FlyerData["templateStyle"], (d: FlyerData) => string> = {
  modern: modernTemplate,
  luxury: luxuryTemplate,
  bold: boldTemplate,
};

export function renderFlyerHtml(data: FlyerData): string {
  const fn = TEMPLATE_MAP[data.templateStyle] ?? modernTemplate;
  return fn(data);
}

function heroSrc(d: FlyerData): string {
  if (d.heroImageBase64) return `data:${d.heroImageMimeType};base64,${d.heroImageBase64}`;
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='500' fill='%23334'%3E%3Crect width='800' height='500'/%3E%3Ctext x='400' y='260' text-anchor='middle' fill='%23889' font-size='28' font-family='sans-serif'%3ENo Photo%3C/text%3E%3C/svg%3E";
}

function factsRow(d: FlyerData): string {
  const parts: string[] = [];
  if (d.beds != null) parts.push(`${d.beds} Bed`);
  if (d.baths != null) parts.push(`${d.baths} Bath`);
  if (d.sqft != null) parts.push(`${d.sqft.toLocaleString()} Sq Ft`);
  return parts.join("&nbsp;&nbsp;|&nbsp;&nbsp;");
}

function bullets(d: FlyerData): string {
  if (!d.featureBullets.length) return "";
  return `<ul style="margin:16px 0 0;padding-left:20px;color:#555;font-size:13px;line-height:1.7">${d.featureBullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
}

function brokerBlock(d: FlyerData): string {
  const logo = d.brokerLogo
    ? `<img src="${d.brokerLogo}" alt="" style="height:32px;margin-right:10px;object-fit:contain"/>`
    : "";
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:20px;padding-top:14px;border-top:1px solid #ddd;font-size:11px;color:#777">
    ${logo}<span><strong style="color:#333">${esc(d.brokerName)}</strong><br/>${esc(d.brokerPhone)}&nbsp;&middot;&nbsp;${esc(d.brokerEmail)}</span>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function modernTemplate(d: FlyerData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:816px;height:1056px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#fff;overflow:hidden}
</style></head><body>
<div style="width:816px;height:1056px;display:flex;flex-direction:column">
  <div style="flex:0 0 480px;overflow:hidden;position:relative">
    <img src="${heroSrc(d)}" style="width:100%;height:100%;object-fit:cover"/>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:24px 32px;background:linear-gradient(transparent,rgba(0,0,0,.65))">
      <div style="font-size:38px;font-weight:700;color:#fff;letter-spacing:-.5px">${esc(d.priceDisplay)}</div>
    </div>
  </div>
  <div style="flex:1;padding:28px 36px;display:flex;flex-direction:column;justify-content:space-between">
    <div>
      <h1 style="font-size:26px;font-weight:700;color:${d.accentColor};margin-bottom:4px">${esc(d.headline)}</h1>
      <p style="font-size:14px;color:#666;margin-bottom:6px">${esc(d.tagline)}</p>
      <p style="font-size:18px;font-weight:600;color:#222;margin-top:12px">${esc(d.address)}</p>
      <p style="font-size:13px;color:#888">${esc(d.city)}${d.state ? `, ${esc(d.state)}` : ""} ${esc(d.zip)}</p>
      <div style="display:flex;gap:24px;margin-top:18px;padding:12px 0;border-top:2px solid ${d.accentColor};border-bottom:2px solid ${d.accentColor};font-size:15px;font-weight:600;color:#333">${factsRow(d)}</div>
      ${bullets(d)}
    </div>
    <div>
      <div style="background:${d.accentColor};color:#fff;text-align:center;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">${esc(d.ctaText)}</div>
      ${brokerBlock(d)}
    </div>
  </div>
</div>
</body></html>`;
}

function luxuryTemplate(d: FlyerData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:816px;height:1056px;font-family:Georgia,'Times New Roman',serif;background:#0d0d0d;color:#f0ead6;overflow:hidden}
</style></head><body>
<div style="width:816px;height:1056px;display:flex;flex-direction:column">
  <div style="flex:0 0 520px;overflow:hidden;position:relative">
    <img src="${heroSrc(d)}" style="width:100%;height:100%;object-fit:cover;filter:brightness(.85)"/>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:36px 40px;background:linear-gradient(transparent 40%,rgba(0,0,0,.75))">
      <div style="font-size:13px;letter-spacing:4px;text-transform:uppercase;color:${d.accentColor};margin-bottom:8px">${esc(d.tagline)}</div>
      <div style="font-size:36px;font-weight:700;line-height:1.15">${esc(d.headline)}</div>
      <div style="font-size:42px;font-weight:700;color:${d.accentColor};margin-top:6px">${esc(d.priceDisplay)}</div>
    </div>
  </div>
  <div style="flex:1;padding:28px 40px;display:flex;flex-direction:column;justify-content:space-between">
    <div>
      <p style="font-size:20px;font-weight:700">${esc(d.address)}</p>
      <p style="font-size:13px;color:#998;margin-top:2px">${esc(d.city)}${d.state ? `, ${esc(d.state)}` : ""} ${esc(d.zip)}</p>
      <div style="display:flex;gap:28px;margin-top:18px;font-size:15px;letter-spacing:1px;color:${d.accentColor}">${factsRow(d)}</div>
      ${d.featureBullets.length ? `<ul style="margin-top:16px;padding-left:18px;color:#bbb;font-size:12px;line-height:1.8">${d.featureBullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid #333;padding-top:14px">
      <div style="font-size:11px;color:#887">
        ${d.brokerLogo ? `<img src="${d.brokerLogo}" alt="" style="height:28px;margin-right:8px;vertical-align:middle;object-fit:contain"/>` : ""}
        <strong style="color:#f0ead6">${esc(d.brokerName)}</strong><br/>${esc(d.brokerPhone)}&nbsp;&middot;&nbsp;${esc(d.brokerEmail)}
      </div>
      <div style="background:${d.accentColor};color:#0d0d0d;padding:8px 18px;border-radius:4px;font-size:12px;font-weight:700;font-family:sans-serif">${esc(d.ctaText)}</div>
    </div>
  </div>
</div>
</body></html>`;
}

function boldTemplate(d: FlyerData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:816px;height:1056px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#fff;overflow:hidden}
</style></head><body>
<div style="width:816px;height:1056px;display:flex">
  <div style="flex:0 0 420px;overflow:hidden">
    <img src="${heroSrc(d)}" style="width:100%;height:100%;object-fit:cover"/>
  </div>
  <div style="flex:1;background:${d.accentColor};color:#fff;padding:36px 32px;display:flex;flex-direction:column;justify-content:space-between">
    <div>
      <div style="font-size:42px;font-weight:800;line-height:1.1;margin-bottom:8px">${esc(d.priceDisplay)}</div>
      <div style="width:50px;height:4px;background:#fff;opacity:.5;margin-bottom:18px"></div>
      <h1 style="font-size:22px;font-weight:700;line-height:1.3;margin-bottom:6px">${esc(d.headline)}</h1>
      <p style="font-size:13px;opacity:.85;margin-bottom:18px">${esc(d.tagline)}</p>
      <p style="font-size:16px;font-weight:600">${esc(d.address)}</p>
      <p style="font-size:12px;opacity:.7">${esc(d.city)}${d.state ? `, ${esc(d.state)}` : ""} ${esc(d.zip)}</p>
      <div style="margin-top:20px;font-size:14px;font-weight:600;line-height:2">${factsRow(d)}</div>
      ${d.featureBullets.length ? `<ul style="margin-top:14px;padding-left:18px;font-size:12px;opacity:.85;line-height:1.8">${d.featureBullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    </div>
    <div>
      <div style="background:#fff;color:${d.accentColor};text-align:center;padding:12px;border-radius:6px;font-size:14px;font-weight:700;margin-bottom:16px">${esc(d.ctaText)}</div>
      <div style="font-size:11px;opacity:.7">
        ${d.brokerLogo ? `<img src="${d.brokerLogo}" alt="" style="height:24px;margin-right:8px;vertical-align:middle;filter:brightness(10);object-fit:contain"/>` : ""}
        <strong>${esc(d.brokerName)}</strong><br/>${esc(d.brokerPhone)}&nbsp;&middot;&nbsp;${esc(d.brokerEmail)}
      </div>
    </div>
  </div>
</div>
</body></html>`;
}
