@echo off
REM sandbox.cmd - Wrapper for scripts/sandbox.ts
REM
REM Usage:
REM   sandbox -spawn              Start isolated test server
REM   sandbox -spawn -copycode    Start with code copy (for deploy-quick tests)
REM   sandbox -list               List running test servers
REM   sandbox -kill <port>        Kill a test server
REM   sandbox -remove <port>      Kill and delete test directory
REM
REM See scripts/sandbox.ts for details.

npx tsx scripts/sandbox.ts %*
