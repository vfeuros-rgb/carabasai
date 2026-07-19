import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/screenplay-pdf": [
      "./node_modules/pdfkit/js/data/*.afm",
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf",
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf",
      "./public/carabasai-pdf-logo-transparent.png",
    ],
  },
  allowedDevOrigins: [
    "10.100.9.104",
    "10.100.9.104:3000",
  ],
};

export default nextConfig;
