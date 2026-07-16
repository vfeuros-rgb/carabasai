"use client";

export const PLATFORM_DIALOG_EVENT = "carabasai-platform-dialog";

export type PlatformDialogRequest = {
  id: string;
  kind: "confirm" | "prompt" | "notice";
  eyebrow?: string;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  tone?: "default" | "danger";
  resolve: (value: boolean | string | null) => void;
};

type DialogOptions = Omit<PlatformDialogRequest, "id" | "kind" | "resolve">;

function requestDialog(kind: PlatformDialogRequest["kind"], options: DialogOptions) {
  return new Promise<boolean | string | null>((resolve) => {
    const detail: PlatformDialogRequest = {
      ...options,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind,
      resolve,
    };
    window.dispatchEvent(new CustomEvent(PLATFORM_DIALOG_EVENT, { detail }));
  });
}

export async function platformConfirm(options: DialogOptions) {
  return (await requestDialog("confirm", options)) === true;
}

export async function platformPrompt(options: DialogOptions) {
  const result = await requestDialog("prompt", options);
  return typeof result === "string" ? result : null;
}

export async function platformNotice(options: DialogOptions) {
  await requestDialog("notice", options);
}
