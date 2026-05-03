export async function measure(page, fn) {
    return await page.evaluate(async (fnStr) => {
        const fn = new Function(`return (${fnStr})`)();

        const start = performance.now();
        await fn();
        const end = performance.now();

        return end - start;
    }, fn.toString());
}