import Link from "next/link";
export function LibraryNav({ active }: { active: "mine" | "explore" }) {
  return (
    <nav
      aria-label="Strategy library"
      className="mt-10 flex gap-7 border-b border-white/10 text-sm"
    >
      {(
        [
          ["mine", "/app", "My strategies"],
          ["explore", "/app/explore", "Explore"],
        ] as const
      ).map(([key, href, label]) => (
        <Link
          key={key}
          href={href}
          aria-current={key === active ? "page" : undefined}
          className={`border-b-2 pb-4 transition-colors ${key === active ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
