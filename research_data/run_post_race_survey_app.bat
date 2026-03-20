@echo off
cd /d %~dp0
python survey_app\server.py --host 127.0.0.1 --port 8765
