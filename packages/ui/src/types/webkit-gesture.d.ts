// Safari trackpad pinch: WebKit fires non-standard gesture events on the
// element under the two-finger gesture. Used by the image viewer zoom.
interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface HTMLElement {
  ongesturestart: ((event: GestureEvent) => void) | null;
  ongesturechange: ((event: GestureEvent) => void) | null;
  ongestureend: ((event: GestureEvent) => void) | null;
}

interface HTMLElementEventMap {
  gesturestart: GestureEvent;
  gesturechange: GestureEvent;
  gestureend: GestureEvent;
}
