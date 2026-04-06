import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { getMissionHref, type MissionNavigate, type MissionView } from "@/mission/navigation";

type MissionLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  view: MissionView;
  navigate: MissionNavigate;
  search?: string;
};

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}

export function MissionLink({ view, navigate, search, onClick, target, ...props }: MissionLinkProps) {
  const href = getMissionHref(view, search);

  return (
    <a
      {...props}
      href={href}
      target={target}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || target === "_blank" || !isPlainLeftClick(event)) {
          return;
        }
        event.preventDefault();
        navigate(view, search ? { search } : undefined);
      }}
    />
  );
}
