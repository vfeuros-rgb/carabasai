import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

export const runtime = "nodejs";

type Payload = {
  title?: string;
  logline?: string;
  screenplay?: string;
  director?: string;
  screenwriter?: string;
};

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "screenplay";
}

function fontBuffer(packagePath: string) {
  return readFileSync(join(process.cwd(), "node_modules", packagePath));
}

export async function POST(request: Request) {
  try {
    await authenticateAiRequest(request);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("PDF EXPORT ACCESS FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }

  const body = await request.json() as Payload;
  if (!body.screenplay?.trim()) return NextResponse.json({ error: "SCREENPLAY IS EMPTY." }, { status: 400 });

  const title = body.title?.trim() || "UNTITLED SCREENPLAY";
  const screenplay = body.screenplay.replace(/\r\n/g, "\n");
  const chunks: Buffer[] = [];
  const document = new PDFDocument({ size: "A4", margins: { top: 62, right: 58, bottom: 62, left: 58 }, bufferPages: true, info: { Title: title, Author: body.screenwriter || "Carabasai Studio", Creator: "Carabasai Studio" } });
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.registerFont("Carabasai", fontBuffer("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"));
  document.registerFont("CarabasaiBold", fontBuffer("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"));
  document.registerFont("Screenplay", fontBuffer("dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf"));
  const logo = readFileSync(join(process.cwd(), "public", "apple-touch-icon-carabasai-v2.png"));

  document.rect(0, 0, 595.28, 841.89).fill("#090909");
  document.rect(0, 0, 595.28, 14).fill("#FFDF00");
  document.image(logo, 58, 54, { width: 42, height: 42 });
  document.fillColor("#FFDF00").font("CarabasaiBold").fontSize(11).text("CARABASAI STUDIO", 114, 68, { characterSpacing: 2.1 });
  document.fillColor("#FFFFFF").font("CarabasaiBold").fontSize(31).text(title.toUpperCase(), 58, 150, { width: 479, lineGap: 5 });
  document.fillColor("#FFDF00").font("CarabasaiBold").fontSize(7).text("PROJECT DESCRIPTION", 58, 252, { characterSpacing: 1.4 });
  document.fillColor("#9A9A9A").font("Carabasai").fontSize(11).text(body.logline?.trim() || "A CARABASAI STUDIO SCREENPLAY.", 58, 274, { width: 420, lineGap: 5 });
  document.moveTo(58, 590).lineTo(537, 590).lineWidth(0.7).strokeColor("#353535").stroke();
  document.fillColor("#707070").font("CarabasaiBold").fontSize(7).text("DIRECTOR", 58, 620, { characterSpacing: 1.4 });
  document.fillColor("#FFFFFF").font("Carabasai").fontSize(10).text(body.director?.trim() || "NOT SPECIFIED", 58, 637);
  document.fillColor("#707070").font("CarabasaiBold").fontSize(7).text("SCREENWRITER", 300, 620, { characterSpacing: 1.4 });
  document.fillColor("#FFFFFF").font("Carabasai").fontSize(10).text(body.screenwriter?.trim() || "NOT SPECIFIED", 300, 637);
  document.fillColor("#555555").font("Carabasai").fontSize(7).text(`GENERATED ${new Date().toISOString().slice(0, 10)}`, 58, 760);

  document.addPage();
  document.fillColor("#111111").font("Screenplay").fontSize(10.2).text(screenplay, 72, 72, { width: 451, lineGap: 4, paragraphGap: 0, align: "left" });

  const pages = document.bufferedPageRange();
  for (let index = 1; index < pages.count; index += 1) {
    document.switchToPage(index);
    document.save();
    document.fillColor("#111111").font("CarabasaiBold").fontSize(7).text("CARABASAI STUDIO", 58, 30, { characterSpacing: 1.2 });
    document.fillColor("#777777").font("Carabasai").fontSize(7).text(title.toUpperCase(), 190, 30, { width: 300, align: "right" });
    document.moveTo(58, 44).lineTo(537, 44).lineWidth(0.5).strokeColor("#D8D8D8").stroke();
    document.fillColor("#777777").font("Carabasai").fontSize(7).text(`${index} / ${pages.count - 1}`, 58, 805, { width: 479, align: "right" });
    document.restore();
  }

  document.end();
  const pdf = await completed;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFilename(title)} - Carabasai.pdf`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
