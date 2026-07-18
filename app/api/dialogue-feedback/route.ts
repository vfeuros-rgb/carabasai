import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

export async function POST(request: Request) {
  try {
    await authenticateAiRequest(request);
    const serviceUrl = (
      process.env.SCREENPLAY_AGENTS_API_URL
      ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8091" : "")
    ).replace(/\/$/, "");
    if (!serviceUrl) return NextResponse.json({ error: "SCREENPLAY AGENTS SERVICE IS NOT CONFIGURED." }, { status: 503 });
    const response = await fetch(`${serviceUrl}/dialogue-feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SCREENPLAY_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.SCREENPLAY_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify(await request.json()),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("DIALOGUE FEEDBACK ACCESS FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }
}
