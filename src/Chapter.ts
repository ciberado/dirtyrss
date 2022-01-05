export class Chapter {
    private _id: string;
    private _title: string;
    private _fileUrl: string;
    private _description: string;
    private _date: Date;

    constructor(id: string, title: string, fileUrl: string, description: string, date: Date) {
        this._id = id;
        this._title = title;
        this._fileUrl = fileUrl;
        this._description = description;
        this._date = date;
    }

    public get id() {
        return this._id;
    }

    public get title() {
        return this._title;
    }

    public get fileUrl() {
        return this._fileUrl;
    }

    public get description() {
        return this._description;
    }

    public get date() {
        return this._date;
    }
}
