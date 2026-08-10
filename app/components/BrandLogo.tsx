// The Spartan Crew mark, in two pieces that are never resized.
//
// It used to be ONE svg that swapped its viewBox and its width between the rail's
// two states — cropped to the arrow when condensed, the full wordmark when open. A
// viewBox swap is not an animation: the geometry jumps, and because the width jumped
// with it the whole logo band snapped. That is the "tweaking" on expand.
//
// So the arrow and the letters are separate elements at FIXED size. The arrow lives
// in the rail's 40px icon column and never moves; the wordmark sits beside it and
// fades in on the same clock as every other label. Nothing interpolates a shape.
//
// The letterforms use currentColor so they read white on the dark theme and near-black
// on the tan one; the arrow keeps its brand red and grey.

const WORDMARK = "currentColor";

/** The arrow alone — the rail's permanent mark. */
export function BrandMark({ height = 26 }: { height?: number }) {
  return (
    <svg
      height={height}
      width={height * (152 / 195)}
      viewBox="645 0 152 195"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Spartan Crew"
      style={{ display: "block", flexShrink: 0 }}
    >
      <polygon fill="#C72218" points="756.59,48.431 647.574,193.112 721.796,193.112 793.701,97.685" />
      <polygon fill="#878787" points="751.377,41.73 721.796,2.254 647.574,2.254 714.267,90.985" />
    </svg>
  );
}

/** The letters alone — "SPARTAN Crew", no arrow. Cropped to the type so it can sit
 *  beside the mark rather than carrying its own copy of it. */
export function BrandWordmark({ height = 22 }: { height?: number }) {
  const vbW = 640, vbH = 195;
  return (
    <svg
      height={height}
      width={height * (vbW / vbH)}
      viewBox={`0 0 ${vbW} ${vbH}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ display: "block", flexShrink: 0, color: "var(--text-primary)" }}
    >
      <g>
        <path fill={WORDMARK} d="M410.633,174.124c-6.455,13.003-18.519,20.297-33.203,20.297c-8.138,0-15.06-2.243-20.485-6.64c-7.294-5.894-11.317-14.497-11.317-23.945c0-10.382,3.929-20.202,11.129-27.685c6.643-6.92,15.901-10.852,26.096-10.852c15.527,0,27.592,8.698,31.427,23.104h-10.85c-3.553-9.072-11.13-14.028-20.952-14.028c-6.921,0-13.281,2.712-18.333,7.947c-4.958,5.241-8.043,12.817-8.043,20.389c0,13.47,9.073,22.542,21.138,22.542c8.887,0,16.931-4.113,21.515-11.129H410.633z" />
        <path fill={WORDMARK} d="M424.285,126.61h16.833c15.997,0,24.509,7.482,24.509,19.736c0,11.876-8.043,20.574-21.888,21.886l13.56,24.88h-10.848l-17.771-32.641c9.352-0.098,15.715,0,19.737-2.34c4.206-2.433,6.733-6.643,6.733-11.315c0-6.926-4.864-11.135-13.655-11.135c-2.059,0-5.144,0.095-9.261,0.374l-11.13,57.057h-9.729L424.285,126.61z" />
        <path fill={WORDMARK} d="M476.938,126.61h34.327l-1.871,9.354h-24.601l-3.555,18.987h24.508l-1.682,9.071h-24.603l-3.836,19.549h24.508l-1.777,9.54h-34.329L476.938,126.61z" />
        <path fill={WORDMARK} d="M525.195,126.61l2.714,54.624l23.1-54.624h12.348l2.059,55.277l23.291-55.277h9.259l-28.339,66.502H557l-1.687-56.214l-24.036,56.214h-11.783l-3.649-66.502H525.195z" />
        <path fill={WORDMARK} d="M28.658,82.591c0,7.887,3.38,11.914,9.66,11.914c6.601,0,10.463-4.183,10.463-11.109c0-6.922-7.245-10.301-17.226-16.904c-13.522-9.014-20.446-17.546-20.446-28.817C11.109,14.328,26.244,0,51.196,0C74.219,0,87.26,11.592,87.26,31.555c0,1.771-0.159,3.704-0.321,5.633h-27.21c0-0.48,0-1.126,0-1.607c0-8.374-2.415-12.559-8.372-12.559c-5.313,0-9.175,4.025-9.175,9.336c0,7.085,7.083,10.306,18.513,18.193c13.363,9.179,19.802,18.839,19.802,31.878c0,21.252-15.454,36.708-41.536,36.708C13.845,119.138,0,106.255,0,83.234c0-1.288,0-2.572,0.162-3.86h28.658C28.658,80.5,28.658,81.626,28.658,82.591z" />
        <path fill={WORDMARK} d="M181.759,38.477c0,12.236-4.991,23.346-13.201,30.429c-11.433,9.659-22.702,10.947-37.191,10.947h-14.972l-7.245,36.87H81.136l22.7-114.47h35.259C166.625,2.253,181.759,16.101,181.759,38.477z M131.367,54.093c12.88,0,19.481-5.148,19.481-14.329c0-9.336-6.118-13.362-19.481-13.362c-1.609,0-3.059,0-4.83,0.162l-5.635,27.529H131.367z" />
        <path fill={WORDMARK} d="M387.307,27.691h-24.471l4.99-25.438h74.06l-4.989,25.438h-21.896l-17.388,89.032h-27.691L387.307,27.691z" />
        <path fill={WORDMARK} d="M216.975,2.253h28.494l20.287,114.47h-29.3l-2.738-16.584h-39.766l-7.891,16.584h-32.841L216.975,2.253z M224.702,35.259l-18.514,39.765h23.987L224.702,35.259z" />
        <path fill={WORDMARK} d="M360.109,37.029c0-22.217-14.813-34.776-42.503-34.776h-35.259l-15.896,80.16l5.943,33.528l0.138,0.782h15.129l8.372-41.214l21.412,41.214h31.717L325.978,75.67C347.874,70.679,360.109,56.189,360.109,37.029z M309.879,55.866h-10.628l5.798-29.301c1.609,0,3.22-0.162,4.67-0.162c13.843,0,19.641,3.704,19.641,14.651C329.36,51.84,322.921,55.866,309.879,55.866z" />
        <path fill={WORDMARK} d="M467.533,2.253h28.497l20.285,114.47h-29.302l-2.738-16.584H444.51l-7.891,16.584h-32.84L467.533,2.253z M475.262,35.259l-18.516,39.765h23.986L475.262,35.259z" />
        <polygon fill={WORDMARK} points="594.607,2.253 581.725,74.221 557.415,2.253 528.115,2.253 514.885,70.413 522.953,115.941 523.093,116.723 533.267,116.723 546.309,46.206 572.874,116.723 600.243,116.723 622.458,2.253" />
      </g>
    </svg>
  );
}

/**
 * The whole lockup, for anywhere that is not the rail (the login window).
 * Kept as the default export so existing call sites are unaffected.
 */
export default function BrandLogo({ height = 30 }: { height?: number; condensed?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: height * 0.3 }}>
      <BrandWordmark height={height * 0.72} />
      <BrandMark height={height * 0.86} />
    </div>
  );
}
