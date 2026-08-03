export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? 'brand-mark brand-mark--small' : 'brand-mark'} aria-hidden="true">
      <span className="brand-ring brand-ring--outer" />
      <span className="brand-ring brand-ring--inner" />
      <span className="brand-core" />
    </div>
  );
}
