import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  buildInstallationGrounding,
  detectedInstallationEnvironments
} from "@/src/lib/chatbot/installation-grounding";
import {
  buildNetworkEngineeringGrounding,
  detectedNetworkTopics
} from "@/src/lib/chatbot/network-grounding";
import { removeUnsupportedProductClaims } from "@/src/lib/chatbot/product-claim-validator";

describe("site-aware installation grounding", () => {
  test("adds parking and ANPR constraints without inventing a camera model", () => {
    const result = buildInstallationGrounding("برای ورودی پارکینگ چطور دوربین پلاک خوان نصب کنم؟");
    assert.match(result, /زاویه افقی و عمودی/);
    assert.match(result, /دوربین زمینه‌ای/);
    assert.match(result, /Part Number دقیق/);
    assert.equal(/TC-|DS-|IPC-/.test(result), false);
    assert.deepEqual(detectedInstallationEnvironments("پارکینگ پلاک‌خوان"), ["parking-anpr"]);
  });

  test("covers privacy-sensitive and industrial environments separately", () => {
    const hospital = buildInstallationGrounding("طراحی دوربین برای بیمارستان");
    const warehouse = buildInstallationGrounding("برای انبار و سوله دوربین نصب می‌کنم");
    assert.match(hospital, /حریم خصوصی/);
    assert.match(warehouse, /لیفتراک/);
    assert.match(warehouse, /فیبر/);
  });

  test("does not inject an installation playbook into unrelated conversation", () => {
    assert.equal(buildInstallationGrounding("فرق H.264 و H.265 چیست؟"), "");
  });
});

describe("network engineering grounding", () => {
  test("grounds VLAN, NVR and firewall topology", () => {
    const result = buildNetworkEngineeringGrounding("برای دوربین‌ها VLAN و فایروال و پورت NVR را طراحی کن");
    assert.match(result, /پورت دوربین Access\/Untagged/);
    assert.match(result, /پورت NVR پیش‌فرض Access/);
    assert.match(result, /VPN با MFA/);
  });

  test("provides topic-specific PoE and fiber constraints", () => {
    const result = buildNetworkEngineeringGrounding("بودجه PoE و فیبر بین دو ساختمان را چطور حساب کنم؟");
    assert.match(result, /بیشینه مصرف دیتاشیت/);
    assert.match(result, /Optical Budget/);
    assert.ok(detectedNetworkTopics("PoE و فیبر بین ساختمان").length >= 2);
  });

  test("does not add network evidence to an unrelated product-only question", () => {
    assert.equal(buildNetworkEngineeringGrounding("یک دوربین تیاندی چهار مگ معرفی کن"), "");
  });
});

describe("verified product claim boundary", () => {
  test("removes an invented model recommendation", () => {
    const result = removeUnsupportedProductClaims(
      "مدل TC-C32FA را بخرید چون میکروفن دارد.\nابتدا فاصله و نور محل را اندازه بگیرید.",
      []
    );
    assert.doesNotMatch(result, /TC-C32FA/);
    assert.match(result, /بدون دیتاشیت تأییدشده/);
    assert.match(result, /فاصله و نور/);
  });

  test("keeps a model backed by the retrieved exact part number", () => {
    const result = removeUnsupportedProductClaims("مدل DS-2CD2043G2-I در منبع بازیابی شد.", ["DS-2CD2043G2-I"]);
    assert.match(result, /DS-2CD2043G2-I/);
    assert.doesNotMatch(result, /حذف شد/);
  });

  test("keeps an explicit not-verified response and technical standards", () => {
    const result = removeUnsupportedProductClaims(
      "مدل IPC-UNKNOWN1 در دیتابیس نیست و قابل تأیید نیست.\nکابل CAT-6 و IEEE-802/3 را طبق طراحی بررسی کنید.",
      []
    );
    assert.match(result, /IPC-UNKNOWN1/);
    assert.match(result, /CAT-6/);
    assert.doesNotMatch(result, /حذف شد/);
  });
});
