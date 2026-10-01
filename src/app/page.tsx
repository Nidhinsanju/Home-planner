"use client";

import dynamic from "next/dynamic";

// Dynamically import the main App to ensure it only renders on the client
// because @react-three/fiber accesses browser APIs like window and document
const ClientApp = dynamic(() => import("../App").then(mod => mod.default), {
  ssr: false,
});

export default function Page() {
  return <ClientApp />;
}
