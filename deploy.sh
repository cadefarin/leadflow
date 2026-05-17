#!/bin/bash
cp ~/Downloads/index.html ~/Desktop/leadflow/index.html
cd ~/Desktop/leadflow
git add .
git commit -m "update"
git push
echo "✅ Deployed to leadflow-roan-delta.vercel.app"
