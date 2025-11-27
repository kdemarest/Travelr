# Travelr Development Environment Setup

The goal is to make the Windows host do almost nothing beyond running Docker Desktop and VS Code, while every dev tool (Node.js, npm, Terraform, AWS CLI, etc.) lives inside a Linux container that mirrors production.

## 1. Windows prerequisites

- Install the latest Windows 11 updates and ensure hardware virtualization is enabled in BIOS/UEFI.
- Sign in with an account that can install apps and tweak Hyper-V/WSL features (Docker Desktop relies on them).

### What lives on Windows vs. inside the container?

- **Windows host:**
  - WSL2 (windows system for linux)
  - Docker Desktop
  - VS Code (with Dev Containers extension)
  - A batch file or two
- **Dev container (Linux):**
  - Node.js + npm
  - nodemon
  - git
  - Terraform/AWS CLI
  - running the actual Travelr app
  - secrets, injected from window

## 2. Install and configure WSL2 and Ubuntu

- Run cmd.exe as administrator.

`dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart`
`dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart`
`curl.exe -L -o "%TEMP%\wsl_update_x64.msi" "https://aka.ms/wsl2kernel"`
`msiexec.exe /i "%TEMP%\wsl_update_x64.msi" /qn /norestart`
`wsl --set-default-version 2`
`wsl.exe -d Ubuntu`
- set user as "dev" and password something simple like "frog"
- from within Ubuntu type "logout"`

## 3. Install Docker Desktop

- Download Docker Desktop for Windows (https://www.docker.com/products/docker-desktop/)
- Install with the **Use WSL 2 based engine** option enabled.
- If in DOS you will have to Ctrl+C when the install is done. Freakish.
- Run Docker Desktop
- On Taskbar right-click Docker, pick Change Settings
  - Go to Settings / General
  - Click "Start Docker Desktop when you sign in"
  - Unclick "Open Docker Dashboard when Docker Desktop starts"
  - Go to Settings / Resources / File Sharing
  - Set to the value of `%USERPROFILE%`
  - Note: You must ALSO use the explicit `-v` host path when running docker containers or when configuring the dev container.
  - Exit the docker GUI
 on the taskbar   
- In Windows go to Settings / Personalization / Taskbar / Other System Tray Icons
   - Find the docker icon and set it to On

- Run cmd.exe or powershell. Run `docker run hello-world` to confirm install

## 4. Install VS Code + extensions

- Install Visual Studio Code (https://code.visualstudio.com/).
- Run VSCode (from cli the command is `cd travelr; code .`)
- Add the **Remote Development** extension pack (includes Dev Containers).

## 5. Clone the repository

- Choose a workspace folder, e.g. `%USERPROFILE%\code`.
- In PowerShell:
  ```powershell
  cd %USERPROFILE%\code
  git clone https://github.com/kdemarest/travelr.git
  cd travelr
  ```

## 6. Open the repo inside a dev container

- Shift+Ctrl+P then **Dev Containers: Reopen in Container**.
- This reads from
  - `travelr/.devcontainer/Dockerfile`
  - `devcontainer.json`
- causing docker to pull the base image
  - `mcr.microsoft.com/devcontainers/javascript-node:24-bookworm`
  - install Terraform
- ultimately allowing VS Code to reuse this definition and mount the workspace at `/workspaces/travelr`.
- After the container finishes building (first run can take several minutes):
  ```bash
  npm install
  npm run build --workspace client
  ```
  These run inside Linux, against the same `C:\Users\kende\code\travelr` files mounted at `/workspaces/travelr`.

## 7. Running the app

- Inside the container terminal:
  ```bash
  npm run dev --workspace server
  npm run dev --workspace client
  ```
- If you prefer Windows terminals, `launch.bat` still opens two local `cmd.exe` windows; both commands read/write the same workspace files.

## 8. Managing secrets

- Do **not** rely on Windows Credential Manager once you run inside Docker.
- Use an `.env` file (ignored by git) or a secrets manager to supply `OPENAI_API_KEY`, `GOOGLE_CS_API_KEY`, and `GOOGLE_CS_CX` via environment variables.
- For local dev, create `.env.local` with those values and load it via `docker compose`, VS Code dev container settings (`"remoteEnv"`), or a tool like `direnv`.

## 9. Terraform / infrastructure tooling (optional)

- Terraform is already baked into the dev container. Keep IaC code under `infra/` or `devenvsetup/terraform/` so that re-provisioning the environment years later is just `terraform init && terraform apply`.

## 10. Verification checklist

- `npm run build --workspace client` succeeds.
- `npm run dev --workspace server` logs "Travelr API listening on http://localhost:4000".
- `npm run dev --workspace client` opens Vite on http://localhost:5173.
- VS Code Dev Container status bar shows `Dev Container: travelr` (meaning commands are running inside Docker).

Document any additional machine-specific tweaks (graphics drivers, VPN requirements, proxy settings) in this directory so future setups remain repeatable.
