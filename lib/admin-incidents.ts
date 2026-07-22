import "server-only";

type IncidentStore = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: { project_document?: unknown; title?: string } | null; error: { message?: string } | null }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
    };
  };
};

export type AdminIncident = {
  id: string;
  createdAt: string;
  service: string;
  action: string;
  status: number;
  message: string;
  userEmail?: string;
  projectId?: string;
  projectTitle?: string;
};

export const PUBLIC_AI_ERROR = "THE TEAM IS TEMPORARILY UNAVAILABLE. TRY AGAIN LATER.";

export async function reportAdminIncident({
  supabase,
  projectId,
  userEmail,
  service,
  action,
  status,
  message,
}: {
  supabase: unknown;
  projectId?: string;
  userEmail?: string;
  service: string;
  action: string;
  status: number;
  message: string;
}) {
  const store = supabase as IncidentStore;
  const incident: AdminIncident = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    service,
    action,
    status,
    message: message.slice(0, 2000),
    userEmail,
    projectId,
  };

  console.error("ADMIN_INCIDENT", incident);

  if (projectId && /^[0-9a-f-]{36}$/i.test(projectId)) {
    try {
      const result = await store.from("projects").select("project_document,title").eq("id", projectId).maybeSingle();
      const projectDocument = result.data?.project_document && typeof result.data.project_document === "object"
        ? { ...(result.data.project_document as Record<string, unknown>) }
        : {};
      const previous = Array.isArray(projectDocument.admin_incidents)
        ? projectDocument.admin_incidents as AdminIncident[]
        : [];
      incident.projectTitle = result.data?.title;
      projectDocument.admin_incidents = [incident, ...previous].slice(0, 50);
      await store.from("projects").update({ project_document: projectDocument }).eq("id", projectId);
    } catch (storeError) {
      console.error("ADMIN_INCIDENT_STORE_FAILED", storeError);
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  const recipients = (process.env.ADMIN_EMAILS ?? "").split(",").map((email) => email.trim()).filter(Boolean);
  if (!resendKey || recipients.length === 0) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ADMIN_ALERT_FROM ?? "Carabasai Alerts <alerts@carabasai.com>",
        to: recipients,
        subject: `[Carabasai] ${service} error (${status})`,
        text: `${action}\n${message}\nProject: ${incident.projectTitle ?? projectId ?? "unknown"}\nUser: ${userEmail ?? "unknown"}\nTime: ${incident.createdAt}`,
      }),
    });
  } catch (emailError) {
    console.error("ADMIN_INCIDENT_EMAIL_FAILED", emailError);
  }
}
