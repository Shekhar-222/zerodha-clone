import { Anchor } from "lucide-react";

export function EmptyState({
  message,
  ctaLabel,
  onCta,
}: {
  message: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-24">
      <Anchor size={56} strokeWidth={1} className="text-gray-300" />
      <p className="text-sm text-gray-500">{message}</p>
      {ctaLabel && (
        <button
          onClick={onCta}
          className="rounded bg-link px-5 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
