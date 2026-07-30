// ChatShell owns the interactive chat workspace and backend integration.
import { ChatShell } from "../components/chat-shell";


// The root page stays intentionally small.
// Product behaviour belongs in dedicated feature components.
export default function HomePage() {
  return <ChatShell />;
}