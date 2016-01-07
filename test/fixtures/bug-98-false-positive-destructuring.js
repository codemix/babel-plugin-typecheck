type TypeDateTime = {
    date: string,
    time: string
};

type TypeAction = {
    data: Object,
    name: string
};

const demo = ({date, time}: TypeDateTime) : TypeAction => {
    return {
        data: {
            date,
            time
        },
        name: 'DATE_TIME'
    };
};

export default demo;
