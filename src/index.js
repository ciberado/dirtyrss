import { default as got } from 'got';
class IVoox {
    constructor() {
    }
    async search(programName) {
        programName = programName.replace(' ', '-');
        const url = `https://www.ivoox.com/${programName}_sw_1_1.html`;
        const searchPage = await got('url');
        console.log(searchPage.body);
    }
}
