#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const TARGET_WIDTH = 440;
const TARGET_HEIGHT = 280;

function normalizeInputPath(inputPath) {
    const raw = String(inputPath || "").trim();

    if (!raw) {
        return "";
    }

    const withoutWrappingQuotes = raw.replace(/^["']|["']$/g, "");
    const normalized = withoutWrappingQuotes.replaceAll("\\", "/");

    // Support Windows absolute paths pasted into WSL:
    // C:\Users\Example\Desktop\tile.png -> /mnt/c/Users/Example/Desktop/tile.png
    // C:/Users/Example/Desktop/tile.png -> /mnt/c/Users/Example/Desktop/tile.png
    const windowsDriveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);

    if (windowsDriveMatch) {
        const drive = windowsDriveMatch[1].toLowerCase();
        const rest = windowsDriveMatch[2];

        return `/mnt/${drive}/${rest}`;
    }

    return normalized;
}

function parseArgs(argv) {
    let inputPath = null;
    let overwrite = false;

    for (const arg of argv) {
        if (arg === "--overwrite") {
            overwrite = true;
            continue;
        }

        if (!inputPath) {
            inputPath = arg;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (!inputPath) {
        throw new Error(
            [
                "Usage:",
                "  node scripts/convert-store-promo-tile.cjs <path-to-image> [--overwrite]",
                "",
                "Examples:",
                "  node scripts/convert-store-promo-tile.cjs assets/store/promo.png",
                "  node scripts/convert-store-promo-tile.cjs assets\\store\\promo.png",
                "  node scripts/convert-store-promo-tile.cjs 'C:\\Users\\Example\\Desktop\\promo.png'",
                "  node scripts/convert-store-promo-tile.cjs /mnt/c/Users/example/Desktop/promo.png",
                "  node scripts/convert-store-promo-tile.cjs assets/store/promo.png --overwrite",
            ].join("\n")
        );
    }

    return {
        inputPath: path.resolve(normalizeInputPath(inputPath)),
        overwrite,
    };
}

function createOutputPath(inputPath, { overwrite }) {
    if (overwrite) {
        return inputPath;
    }

    const dir = path.dirname(inputPath);
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);

    return path.join(dir, `${base}-small-promo-440x280.png`);
}

function createTemporaryOutputPath(inputPath) {
    const dir = path.dirname(inputPath);
    const ext = path.extname(inputPath) || ".png";
    const base = path.basename(inputPath, ext);

    return path.join(
        dir,
        `.${base}.small-promo-440x280.tmp-${process.pid}-${Date.now()}.png`
    );
}

function describeMetadata(metadata) {
    return [
        `${metadata.width || "?"}x${metadata.height || "?"}`,
        `${metadata.channels || "?"} channel(s)`,
        metadata.format || "unknown format",
        metadata.space ? `${metadata.space} colorspace` : null,
        metadata.hasAlpha ? "alpha" : "no alpha",
    ]
        .filter(Boolean)
        .join(", ");
}

async function convertImage(inputPath, outputPath, { overwrite }) {
    const inputMetadata = await sharp(inputPath).metadata();
    const actualOutputPath = overwrite
        ? createTemporaryOutputPath(inputPath)
        : outputPath;

    try {
        await sharp(inputPath)
            .rotate()
            .resize(TARGET_WIDTH, TARGET_HEIGHT, {
                fit: "cover",
                position: "center",
            })
            .flatten({ background: "#ffffff" })
            .toColorspace("srgb")
            .png({
                compressionLevel: 9,
                palette: false,
            })
            .toFile(actualOutputPath);

        const outputMetadata = await sharp(actualOutputPath).metadata();

        if (
            outputMetadata.width !== TARGET_WIDTH ||
            outputMetadata.height !== TARGET_HEIGHT ||
            outputMetadata.channels !== 3 ||
            outputMetadata.format !== "png" ||
            outputMetadata.hasAlpha
        ) {
            throw new Error(
                [
                    "Output is not Chrome Web Store small promo tile compliant:",
                    `  ${actualOutputPath}`,
                    `  ${describeMetadata(outputMetadata)}`,
                    "",
                    "Expected:",
                    `  ${TARGET_WIDTH}x${TARGET_HEIGHT}, 3 channels, PNG, no alpha`,
                ].join("\n")
            );
        }

        if (overwrite) {
            fs.renameSync(actualOutputPath, outputPath);
        }

        return {
            inputMetadata,
            outputMetadata,
        };
    } catch (error) {
        if (overwrite && fs.existsSync(actualOutputPath)) {
            fs.rmSync(actualOutputPath, { force: true });
        }

        throw error;
    }
}

async function main() {
    const { inputPath, overwrite } = parseArgs(process.argv.slice(2));

    if (!fs.existsSync(inputPath)) {
        throw new Error(
            [
                `File not found: ${inputPath}`,
                "",
                "Tips:",
                "  - In WSL, repo-relative paths can use either / or \\ separators.",
                "  - Windows absolute paths are supported and converted to /mnt/<drive>/...",
                "  - Make sure the file name and extension are correct.",
            ].join("\n")
        );
    }

    const stat = fs.statSync(inputPath);

    if (!stat.isFile()) {
        throw new Error(`Not a file: ${inputPath}`);
    }

    const outputPath = createOutputPath(inputPath, { overwrite });
    const { inputMetadata, outputMetadata } = await convertImage(
        inputPath,
        outputPath,
        { overwrite }
    );

    console.log(
        [
            overwrite
                ? "Overwrote Chrome Web Store small promo tile:"
                : "Converted Chrome Web Store small promo tile:",
            `  input:  ${inputPath}`,
            `          ${describeMetadata(inputMetadata)}`,
            `  output: ${outputPath}`,
            `          ${describeMetadata(outputMetadata)}`,
            "",
            "Result is Chrome Web Store small promo tile compliant:",
            `  ${TARGET_WIDTH}x${TARGET_HEIGHT}`,
            "  24-bit PNG / RGB",
            "  no alpha channel",
        ].join("\n")
    );
}

main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
});