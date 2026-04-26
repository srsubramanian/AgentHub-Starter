export const metadata = {
  title: "AgentHub Starter",
  description: "AG-UI protocol starter with LangGraph + AWS Bedrock",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
