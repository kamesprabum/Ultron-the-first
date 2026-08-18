export type JarvisActionType = "connect_gmail" | "connect_googlecalendar";

export interface JarvisAction {
  type: JarvisActionType;
  label: string;
  service: "gmail" | "googlecalendar";
}

/**
 * Safely parses strongly typed assistant action markers from model output.
 * Guarantees that only known, trusted actions can be triggered by the frontend.
 */
export function parseJarvisAction(rawText: string): {
  cleanText: string;
  action: JarvisAction | null;
} {
  if (!rawText) {
    return { cleanText: "", action: null };
  }

  if (rawText.includes("[ACTION:connect_gmail]") || rawText.includes("[ACTION:CONNECT_GMAIL]")) {
    return {
      cleanText: rawText
        .replace(/\[ACTION:(connect_gmail|CONNECT_GMAIL)\]/g, "")
        .trim(),
      action: {
        type: "connect_gmail",
        label: "Connect Gmail",
        service: "gmail",
      },
    };
  }

  if (
    rawText.includes("[ACTION:connect_googlecalendar]") ||
    rawText.includes("[ACTION:CONNECT_CALENDAR]")
  ) {
    return {
      cleanText: rawText
        .replace(/\[ACTION:(connect_googlecalendar|CONNECT_CALENDAR)\]/g, "")
        .trim(),
      action: {
        type: "connect_googlecalendar",
        label: "Connect Google Calendar",
        service: "googlecalendar",
      },
    };
  }

  return { cleanText: rawText, action: null };
}
