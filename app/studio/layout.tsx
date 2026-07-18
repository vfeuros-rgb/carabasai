export default function StudioLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-studio-shell className="studio-shell min-h-screen">
      <div className="studio-shell__background" aria-hidden="true" />
      <div className="studio-shell__veil" aria-hidden="true" />
      {children}
    </div>
  );
}
