"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const S = require("./store"),
  D = require("./data"),
  E = require("./editorial");
const { Operations } = require("./service");
function vault(db, safeStorage) {
  const definitions = {
    searchad: {
      apiKey: "BLOGAUTO_SEARCHAD_API_KEY",
      secret: "BLOGAUTO_SEARCHAD_SECRET",
      customerId: "BLOGAUTO_SEARCHAD_CUSTOMER_ID",
    },
    datalab: {
      clientId: "BLOGAUTO_DATALAB_CLIENT_ID",
      clientSecret: "BLOGAUTO_DATALAB_CLIENT_SECRET",
    },
  };
  const available = () =>
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  return {
    status: () =>
      Object.fromEntries(
        Object.keys(definitions).map((p) => [
          p,
          {
            configured: Boolean(
              S.meta(db, "credential:" + p) ||
                Object.values(definitions[p]).every((n) => process.env[n]),
            ),
            encryptedStorageAvailable: available(),
          },
        ]),
      ),
    read: (provider) => {
      if (!definitions[provider]) throw Error("API 종류를 확인하세요.");
      const stored = S.meta(db, "credential:" + provider);
      if (stored) {
        if (!available())
          throw Error(
            "운영체제 암호 저장소를 사용할 수 없습니다. 파일 업로드를 이용하세요.",
          );
        return JSON.parse(
          safeStorage.decryptString(Buffer.from(stored, "base64")),
        );
      }
      const value = Object.fromEntries(
        Object.entries(definitions[provider]).map(([key, name]) => [
          key,
          process.env[name] || "",
        ]),
      );
      if (Object.values(value).some((v) => !v))
        throw Error(
          "공식 API 자격 증명을 설정하거나 CSV/XLSX 파일을 업로드하세요.",
        );
      return value;
    },
    save: (provider, input) => {
      if (!definitions[provider] || !available())
        throw Error(
          "운영체제 암호 저장소가 필요합니다. 키를 평문으로 저장하지 않습니다. CSV/XLSX도 사용할 수 있습니다.",
        );
      const value = {};
      for (const key of Object.keys(definitions[provider])) {
        if (
          typeof input?.[key] !== "string" ||
          !input[key].trim() ||
          input[key].length > 500
        )
          throw Error("API 필수 항목을 입력하세요.");
        value[key] = input[key].trim();
      }
      S.setMeta(
        db,
        "credential:" + provider,
        safeStorage.encryptString(JSON.stringify(value)).toString("base64"),
      );
      return { saved: true };
    },
  };
}
function register({ ipcMain, dialog, safeStorage, window, root, ...hooks }) {
  const service = new Operations(root, hooks);
  service.hooks.vault = vault(service.db, safeStorage);
  for (const p of service.db
    .prepare(
      "SELECT p.id,d.account FROM ops_publications p JOIN ops_documents d ON d.id=p.document WHERE p.state=?",
    )
    .all("running")) {
    service.db
      .prepare("UPDATE ops_publications SET state=?,updated_at=? WHERE id=?")
      .run("uncertain", S.now(), p.id);
    S.event(service.db, p.account, p.id, "publication_uncertain", {
      reason: "앱 재시작 전 발행 결과 미확인",
    });
  }
  function guard(event, account) {
    if (event.sender !== window()?.webContents)
      throw Error("앱 창에서 실행하세요.");
    service.account(account);
  }
  ipcMain.handle("operations:state", (event, { accountId, filters = {} }) => {
    guard(event, accountId);
    return service.snapshot(accountId, filters);
  });
  ipcMain.handle(
    "operations:action",
    async (event, { accountId, action, payload = {} }) => {
      guard(event, accountId);
      switch (action) {
        case "openSource":
          return hooks.openExternal(require("./tabular").http(payload.url));
        case "installCategories":
          return hooks.installCategories(accountId);
        case "applyBenchmark": {
          const prefs = require("../writingMemory").list(root, accountId);
          return require("../writingMemory").savePreferences(root, accountId, {
            ...prefs,
            formatProfile: payload.profile,
          });
        }
        case "importPreview": {
          const result = await dialog.showOpenDialog(window(), {
            title: "관리자 CSV/XLSX 가져오기",
            properties: ["openFile"],
            filters: [{ name: "CSV / Excel", extensions: ["csv", "xlsx"] }],
          });
          if (result.canceled) return null;
          const file = result.filePaths[0];
          if (fs.statSync(file).size > 8 * 1024 * 1024)
            throw Error("파일은 최대 8MB입니다.");
          return service.stage(
            accountId,
            fs.readFileSync(file),
            path.basename(file),
            payload.kind,
            payload.platform,
            payload.metadata || {},
          );
        }
        case "importCommit":
          return service.import(accountId, payload.token);
        case "template": {
          if (!D.templates[payload.kind])
            throw Error("파일 종류를 확인하세요.");
          const result = await dialog.showSaveDialog(window(), {
            title: "업로드 양식 저장",
            defaultPath: "FOLAX-" + payload.kind + ".csv",
            filters: [{ name: "CSV", extensions: ["csv"] }],
          });
          if (result.canceled) return null;
          fs.writeFileSync(
            result.filePath,
            "\uFEFF" + D.templates[payload.kind] + "\r\n",
            "utf8",
          );
          return { saved: true };
        }
        case "refresh":
          return service.refresh(accountId, payload);
        case "addTopic":
          return service.addTopic(accountId, payload);
        case "topicState":
          return service.setTopic(accountId, payload.id, payload.status);
        case "generate":
          return service.generate(accountId, payload.id, payload);
        case "competition":
          return service.competition(accountId, payload.id);
        case "annotateCompetition":
          return service.annotate(accountId, payload.id, payload);
        case "document":
          return service.document(accountId, payload.id);
        case "saveDocument":
          return service.save(accountId, payload.id, payload);
        case "restoreVersion": {
          const d = service.document(accountId, payload.id),
            v = d.versions.find((v) => v.version === payload.version);
          if (!v) throw Error("저장된 버전이 없습니다.");
          return service.save(accountId, payload.id, {
            title: v.title,
            article: v.article,
            expectedVersion: d.current_version,
          });
        }
        case "analyzeRelevance":
          return service.review(accountId,payload.id,{analyzeRelevance:true});
        case "review":
          return service.review(accountId, payload.id);
        case "repair":
          return service.repair(accountId, payload.id, payload);
        case "approve":
          return service.approve(accountId, payload.id, payload);
        case "revoke":
          return service.revoke(accountId, payload.id);
        case "variant":
          return service.variant(accountId, payload.id);
        case "prepare":
          return service.prepare(accountId, payload.id, payload);
        case "publish":
          return service.publish(accountId, payload.id, payload);
        case "resolvePublication":
          return service.resolve(accountId, payload.id, payload);
        case "profile": {
          const memory = require("../writingMemory"),
            previous = memory.list(root, accountId);
          const result = E.saveProfile(service.db, accountId, payload);
          memory.savePreferences(root, accountId, {
            ...previous,
            enabled: payload.enabled,
          });
          return result;
        }
        case "benchmark":
          return service.addBenchmark(accountId, payload);
        case "analyzeCapture":
          return service.analyzeCapture(accountId, payload.id);
        case "benchmarkCapture": {
          const picked = await dialog.showOpenDialog(window(), {
            properties: ["openFile"],
            filters: [
              { name: "화면 캡처", extensions: ["png", "jpg", "jpeg", "webp"] },
            ],
          });
          if (picked.canceled) return null;
          const file = picked.filePaths[0];
          if (fs.statSync(file).size > 8 * 1024 * 1024)
            throw Error("캡처는 최대 8MB입니다.");
          const dir = path.join(root, "benchmark-captures");
          fs.mkdirSync(dir, { recursive: true });
          const target = path.join(
            dir,
            S.id() + path.extname(file).toLowerCase(),
          );
          fs.copyFileSync(file, target);
          return service.addBenchmark(accountId, {
            ...payload,
            text: "",
            capturePath: target,
          });
        }
        case "preferences":
          return service.preferences(accountId, payload);
        case "credential":
          return service.hooks.vault.save(payload.provider, payload.values);
        case "publicationMode": {
          if (!["approval", "legacy_auto"].includes(payload.mode))
            throw Error("발행 모드를 선택하세요.");
          hooks.saveSettings({ publicationMode: payload.mode });
          return { mode: payload.mode };
        }
        case "weeklyReport": {
          const report = require("./analytics").report(
            service.db,
            accountId,
            hooks.history(accountId),
          );
          const result = await dialog.showSaveDialog(window(), {
            defaultPath: "FOLAX-weekly-" + report.referenceDate + ".json",
            filters: [{ name: "JSON", extensions: ["json"] }],
          });
          if (result.canceled) return null;
          fs.writeFileSync(result.filePath, JSON.stringify(report, null, 2));
          return { saved: true };
        }
        default:
          throw Error("지원하지 않는 콘텐츠 작업입니다.");
      }
    },
  );
  const timer = setInterval(() => service.tick().catch(() => {}), 60000);
  timer.unref();
  service.dispose = () => {
    clearInterval(timer);
    S.close(root);
  };
  return service;
}
module.exports = { register, vault };
