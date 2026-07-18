export default function StudioLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-studio-shell className="studio-shell min-h-screen">
      {children}
    </div>
  );
}
