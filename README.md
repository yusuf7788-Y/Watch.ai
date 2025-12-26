# Watch.ai - Elite Agentic AI IDE

Watch.ai is a next-generation, autonomous software engineering platform built on Top of Visual Studio Code (Code - OSS). It integrates powerful AI agents directly into the development environment to automate complex coding tasks.

## 🚀 Key Features

- **Autonomous Agentic AI**: Powered by `Minimax-M2.1` via OpenRouter.
- **Planner-Executor-Reviewer Architecture**: A specialized state machine for precision coding.
- **Persistent Cloud History**: Chat history is automatically synced and persisted using **Firebase Firestore**.
- **Context Awareness**: Real-time context management for accurate code suggestions and edits.
- **Full-Stack Integration**: Includes a custom VS Code build, a dedicated server, and a modern web client.

## 🛠 Project Structure

- `/vscode`: Custom-built VS Code (Code - OSS) source code.
- `/vscode/extensions/watch-ai`: The heart of Watch.ai's agentic features.
- `/server`: Node.js backend handling AI operations and terminal tasks.
- `/client`: React-based web dashboard.

## ⚙️ Setup & Installation

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (Project uses various versions, see `.nvmrc`)
- [Git](https://git-scm.com/)

### 2. Configuration (Secrets)
To protect sensitive data, API keys are managed via `secrets.json`.

1. Navigate to: `vscode/extensions/watch-ai/src/`
2. Create a file named `secrets.json` based on `secrets.example.json`:
```json
{
  "openRouterApiKey": "YOUR_OPENROUTER_API_KEY",
  "firebase": {
    "apiKey": "YOUR_FIREBASE_API_KEY",
    "projectId": "YOUR_PROJECT_ID"
  }
}
```

### 3. Firebase Setup
1. Create a **Firestore Database** in the Firebase Console.
2. Set the rules to allow read/write (or add your preferred auth):
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /conversations/{conversationId} {
      allow read, write: if true;
    }
  }
}
```

## 🏃 How to Run

### VS Code Extension (Development Mode)
1. Open the project in VS Code.
2. Navigate to `vscode/extensions/watch-ai`.
3. Run `npm install` and `npm run compile`.
4. Run the main VS Code build from the root:
```powershell
.\scripts\code.bat
```

### Server
1. Navigate to `/server`.
2. Create a `.env` file (see `.env.example` if available, or manually set `OPENROUTER_API_KEY`).
3. Run:
```bash
npm install
node index.js
```

### Client
1. Navigate to `/client`.
2. Run:
```bash
npm install
npm run dev
```

---
Built with ❤️ by **yusuf7788-Y**
