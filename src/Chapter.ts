export class Chapter {
    private _id: string;
    private _title: string;
    private _fileUrl: string;
    private _description: string;
    private _date: Date;
    private _image: string;
    private _duration: string;

    constructor(id: string, title: string, fileUrl: string, description: string, date: Date, image: string, duration: string) {
        this._id = id;
        this._title = title;
        this._fileUrl = fileUrl;
        this._description = description;
        this._date = date;
        this._image = image;
        this._duration = duration;
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

    public get image() {
        return this._image;
    }

    public get duration() {
        return this._duration;
    }
}