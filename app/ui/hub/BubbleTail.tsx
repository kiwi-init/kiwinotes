// O rabo do balão do KiwiCat no hub (T14933): o mesmo SVG do overlay (`kiwicat-v2/bubbleTail.ts`).
import { TAIL_SVG_INNER, type TailSide } from "../kiwicat-v2/bubbleTail";

export function BubbleTail({ side = "right" }: { side?: TailSide }) {
  return (
    <svg
      className="kn-bubble-tail"
      data-side={side}
      width="34"
      height="24"
      viewBox="0 0 34 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: TAIL_SVG_INNER }}
    />
  );
}
