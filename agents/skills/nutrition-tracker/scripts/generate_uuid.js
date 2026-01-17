#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");

process.stdout.write(`${randomUUID()}\n`);
