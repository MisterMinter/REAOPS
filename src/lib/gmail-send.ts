import { google } from "googleapis";

export type SendEmailParams = {
  accessToken: string;
  to: string;
  subject: string;
  bodyHtml: string;
  pdfBuffer?: Buffer;
  pdfFilename?: string;
};

export async function sendEmail(params: SendEmailParams): Promise<{ messageId: string }> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: params.accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const parts: string[] = [];

  parts.push(
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "MIME-Version: 1.0",
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    params.bodyHtml
  );

  if (params.pdfBuffer && params.pdfFilename) {
    parts.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${params.pdfFilename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${params.pdfFilename}"`,
      "",
      params.pdfBuffer.toString("base64")
    );
  }

  parts.push(`--${boundary}--`);

  const raw = Buffer.from(parts.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return { messageId: res.data.id ?? "" };
}
