// O rabo do balão do KiwiCat no hub (T14933): o mesmo SVG do overlay (`kiwicat-v2/bubbleTail.ts`). A quina vem do lado
// em que o balão abre (`useBubbleCorner`, T16754).
import { TAIL_SVG_INNER } from "../kiwicat-v2/bubbleTail";
import { useBubbleCorner } from "./bubbleCorner";

export function BubbleTail() {
  const side = useBubbleCorner();
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
