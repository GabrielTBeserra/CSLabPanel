export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="logo-mark" fill="none" height={size} viewBox="0 0 48 48" width={size}>
      <rect fill="#111821" height="46" rx="11" stroke="#263244" width="46" x="1" y="1" />
      <path d="M11 22 24 11l13 11" stroke="#ff9f1c" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />
      <circle cx="24" cy="29" r="8" stroke="#eef2f7" strokeWidth="2.5" />
      <path d="M24 17.5v4M24 36.5v4M12.5 29h4M31.5 29h4" stroke="#eef2f7" strokeLinecap="round" strokeWidth="2.5" />
      <circle className="logo-dot" cx="24" cy="29" fill="#ff9f1c" r="2.2" />
    </svg>
  );
}
