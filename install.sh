#!/usr/bin/env bash
# Deskcity installer for Mac and Linux. Run it with: bash install.sh
# Safe to run again; each step skips what is already done.
#   bash install.sh --yes               take the defaults and ask nothing (basic setup, NO password (loud warning), no autostart, do not start)
#   bash install.sh --remove-autostart  remove the Linux start-at-sign-in entry this installer can make
# Needs no admin rights and sends nothing anywhere (npm fetches the packages, that is all).
# It never reads or prints your .env file. Mac and Linux are untested on real systems; Windows is the tested one.
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
YES=0
UNIT="$HOME/.config/systemd/user/deskcity.service"

if [ "${1:-}" = "--remove-autostart" ]; then
  if [ -f "$UNIT" ]; then
    systemctl --user disable --now deskcity.service >/dev/null 2>&1
    rm -f "$UNIT"
    systemctl --user daemon-reload >/dev/null 2>&1
    echo "Removed the start-at-sign-in entry."
  else
    echo "There is no start-at-sign-in entry to remove."
  fi
  exit 0
fi
[ "${1:-}" = "--yes" ] && YES=1

ANS=N
# ask "question" default-if-asked default-with---yes   (sets ANS to Y or N)
ask() {
  ANS="$2"
  if [ "$YES" = "1" ]; then ANS="$3"; return 0; fi
  local reply=""
  read -r -p "      $1 [$2 is the default, type Y or N]: " reply || true
  case "$reply" in [Yy]*) ANS=Y ;; [Nn]*) ANS=N ;; esac
}

# edit_file path: opens a file in your editor and waits until you are done
edit_file() {
  if [ -n "${EDITOR:-}" ]; then
    $EDITOR "$1"
  elif command -v nano >/dev/null 2>&1; then
    nano "$1"
  elif [ "$(uname)" = "Darwin" ] && command -v open >/dev/null 2>&1; then
    open -e -W "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1
    read -r -p "      Saved and closed it? Press Enter to go on. " _ || true
  else
    echo "      Open $1 in any text editor, save it, then press Enter."
    read -r _ || true
  fi
}

fail() {
  echo
  echo "      $1"
  echo
  echo "The installer stopped. Run it again after fixing the above."
  exit 1
}

echo
echo "Deskcity installer"
[ "$YES" = "1" ] && echo "(--yes: taking the defaults, asking nothing.)"
echo

echo "[1/8] Checking that Node.js 20 or newer is installed..."
NODEMAJOR=0
if command -v node >/dev/null 2>&1; then
  NODEV="$(node -v)"
  NODEMAJOR="${NODEV#v}"; NODEMAJOR="${NODEMAJOR%%.*}"
fi
case "$NODEMAJOR" in ''|*[!0-9]*) NODEMAJOR=0 ;; esac
if [ "$NODEMAJOR" -lt 20 ]; then
  echo
  echo "      Node.js 20 or newer was not found (or is too old). Get it from https://nodejs.org"
  echo "      (the LTS version), install it, then run this installer again."
  ask "Open nodejs.org in your browser now?" Y N
  if [ "$ANS" = "Y" ] && [ "${DESKCITY_NO_BROWSER:-}" != "1" ]; then
    if command -v open >/dev/null 2>&1; then open "https://nodejs.org"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "https://nodejs.org" >/dev/null 2>&1; fi
  fi
  fail "Install Node.js first."
fi
echo "      Node $NODEV is installed. OK."

echo "[2/8] Installing the packages (npm install). This can take a few minutes..."
if [ -f node_modules/.package-lock.json ]; then
  echo "      Already installed. Skipped. (To refresh them, run npm install yourself.)"
else
  npm install || fail "npm install did not finish. Read the lines above for the reason (often no internet). Fix that and run this again."
  echo "      Packages installed. OK."
fi
npm run addons:install || echo "      Some add-on packages did not install. You can retry any time with: npm run addons:install"

echo "[3/8] Your keys file (.env)..."
if [ -f .env ]; then
  echo "      .env is already there. Skipped."
else
  [ -f .env.example ] || fail ".env.example is missing, so .env could not be made. Re-download the Deskcity files."
  cp .env.example .env || fail "Could not make .env. Is this folder read-only?"
  echo "      Made .env from .env.example."
  if [ "$YES" = "1" ]; then
    echo "      Skipped editing it. Open .env later and paste your Claude key after ANTHROPIC_API_KEY="
  else
    echo "      Opening .env. Paste your Claude key after ANTHROPIC_API_KEY=, then save and close it."
    echo "      No key yet? Just close it: you can try the demo with npm run demo, and add the key later."
    edit_file .env
  fi
fi

echo "[4/8] Dashboard password..."
if node tools/setup.mjs --check | grep -q "dashboard password set"; then
  echo "      A password is already set. Skipped."
else
  # Enter = yes when you are asked. With --yes nothing is asked and the interactive set-password is not run.
  ask "Set a dashboard password now? (needed for spending and phone access)" Y N
  if [ "$ANS" = "Y" ]; then
    npm run set-password || echo "      No password was set. You can run npm run set-password any time."
  elif [ "$YES" = "1" ]; then
    echo
    echo "      ####################################################################"
    echo "      #  WARNING: NO DASHBOARD PASSWORD IS SET.                          #"
    echo "      #  This unattended install (--yes) skipped it. Until you run       #"
    echo "      #      npm run set-password                                        #"
    echo "      #  the hub runs WITHOUT a password: anything on this computer can  #"
    echo "      #  start paid work (monthly caps and hourly limits still apply).   #"
    echo "      ####################################################################"
    echo
  else
    echo "      Skipped. Run npm run set-password any time. Until then anything on this computer can start paid work."
  fi
fi

echo "[5/8] Your projects and settings..."
if [ -f data/hub-settings.json ]; then
  echo "      Settings already exist (data/hub-settings.json). Skipped."
else
  CH=2
  if [ "$YES" != "1" ]; then
    echo "      1 = Set up with Claude Code (it asks you a few questions)"
    echo "      2 = Basic setup now (edit a short answers file)"
    echo "      3 = Skip for now"
    read -r -p "      Choose 1, 2 or 3 [2]: " CH || true
    case "$CH" in 1|3) ;; *) CH=2 ;; esac
  fi
  if [ "$CH" = "1" ]; then
    echo "      Open this folder in Claude Code and say: set up my hub"
    echo "      It follows docs/kit/SETUP.md and asks you a few questions."
  elif [ "$CH" = "3" ]; then
    echo "      Skipped. Run this installer again, or see the README, when you are ready."
  else
    if [ ! -f data/setup-answers.json ]; then
      node tools/setup.mjs --example || fail "The setup did not finish. Read the lines above, then run this installer again."
    fi
    if [ "$YES" != "1" ]; then
      echo "      Opening data/setup-answers.json. Put in your name and projects, then save and close it."
      edit_file data/setup-answers.json
    fi
    node tools/setup.mjs --answers data/setup-answers.json || fail "The setup did not finish. Read the lines above, fix the answers file, and run this installer again."
    echo "      Settings made. OK."
  fi
fi

echo "[6/8] Checking what is in place..."
node tools/setup.mjs --check

echo "[7/8] Start at sign-in (optional)..."
if [ "$(uname)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  if [ -f "$UNIT" ]; then
    echo "      The start-at-sign-in entry is already there. Skipped. (Remove it with: bash install.sh --remove-autostart)"
  else
    ask "Start Deskcity by itself when you sign in?" N N
    if [ "$ANS" = "Y" ]; then
      mkdir -p "$(dirname "$UNIT")"
      printf '[Unit]\nDescription=Deskcity\n\n[Service]\nWorkingDirectory="%s"\nExecStart=/usr/bin/env bash "%s/start.sh" --no-browser\nRestart=no\n\n[Install]\nWantedBy=default.target\n' "$HERE" "$HERE" > "$UNIT"
      systemctl --user daemon-reload && systemctl --user enable deskcity.service && echo "      Made it. Remove it later with: bash install.sh --remove-autostart" || echo "      Could not turn it on."
    fi
  fi
else
  echo "      Not covered here: start-at-sign-in is only set up on Linux with systemd. On a Mac, start Deskcity with bash start.sh."
fi

echo "[8/8] Starting..."
ask "Start Deskcity now?" Y N
if [ "$ANS" = "Y" ]; then
  echo "      Starting it. Your browser opens when it is ready. Press Ctrl+C to stop it."
  exec bash "$HERE/start.sh"
fi
echo "      Not started. Start it any time with: bash start.sh"
echo
echo "Done. Start Deskcity any time with: bash start.sh"
