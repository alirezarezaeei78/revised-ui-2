export type AssistantReasoningMode = "low" | "medium" | "high";

export const reasoningModes: Record<
  AssistantReasoningMode,
  { label: string; description: string }
> = {
  low: { label: "کم", description: "سریع و کم‌مصرف روی CPU" },
  medium: { label: "متوسط", description: "تعادل سرعت، دانش و استدلال" },
  high: { label: "زیاد", description: "استدلال عمیق و راستی‌آزمایی با همان مدل محلی" }
};
