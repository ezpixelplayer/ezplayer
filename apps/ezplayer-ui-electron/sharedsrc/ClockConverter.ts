class TimeSample {
    constructor(
        readonly ctBase: number,
        readonly pnBase: number,
    ) {}
    ctSum: number = 0;
    pnSum: number = 0;
    nSamples: number = 0;
}
export class ClockConverter {
    timeSampler: TimeSample;
    constructor(
        readonly name: string,
        ct: number,
        pn = performance.now(),
    ) {
        this.timeSampler = new TimeSample(ct, pn);
    }

    correctionInterval = 120000;
    samplesPerCorrectionInterval = 600;

    getSampleInterval() {
        return this.correctionInterval / this.samplesPerCorrectionInterval;
    }

    curIncarnation: number = 0;
    perfNowBase: number = -1;
    computedClockBase: number = -1;
    computedClockRate: number = 1;

    // Use this approach if we want no long-term rate logic
    setTime(ct: number, pn: number, incarnation: number = 0) {
        this.perfNowBase = pn;
        this.computedClockBase = ct;
        this.timeSampler = new TimeSample(ct, pn);
        this.curIncarnation = incarnation;
    }

    addSample(ct: number, pn: number, incarnation: number = 0) {
        //if (this.name === 'audio') {
        //  console.log(`Audio clock ${ct}/${pn}-${ct-pn}, ${this.computeTime(pn)}`)
        //}
        if (this.perfNowBase < 0 || this.curIncarnation !== incarnation) {
            this.perfNowBase = pn;
            this.computedClockBase = ct;
            this.timeSampler = new TimeSample(ct, pn);
            this.curIncarnation = incarnation;
            return;
        } else {
            // See if this is wildly off... if so, rebaseline now!
            const predictedTime = this.computeTime(pn);
            if (Math.abs(ct - predictedTime) > 1000) {
                // This is a discontinuity
                console.log(`Discontinuity in clock ${this.name} time: ${ct} vs predicted ${predictedTime}`);
                this.perfNowBase = pn;
                this.computedClockBase = ct;
                this.computedClockRate = (this.computedClockRate + 1) / 2;
                this.timeSampler = new TimeSample(ct, pn);
            }
        }

        // Collect as sample
        this.timeSampler.ctSum += ct;
        this.timeSampler.pnSum += pn;
        this.timeSampler.nSamples++;

        if (this.timeSampler.nSamples >= this.samplesPerCorrectionInterval) {
            const calcCt = this.timeSampler.ctSum / this.timeSampler.nSamples;
            const calcPn = this.timeSampler.pnSum / this.timeSampler.nSamples;
            const calcRate = (calcCt - this.timeSampler.ctBase) / (calcPn - this.timeSampler.pnBase);

            console.log(`Calculated rate of ${this.name}: ${calcRate}`);
            const timeWeSay = this.computeTime(pn);
            const timeWeShouldSay = calcCt + calcRate * (pn - calcPn);
            const timeOff = timeWeSay - timeWeShouldSay;
            console.log(`Most recently off by ${timeOff}`);

            // Try to recover in the next interval
            this.computedClockBase = timeWeSay;
            this.perfNowBase = pn;
            this.computedClockRate = calcRate - timeOff / this.correctionInterval;

            console.log(`Setting new rate of ${this.name} to ${this.computedClockRate}`);

            this.timeSampler = new TimeSample(
                (1 * calcCt + 1 * this.timeSampler.ctBase) / 2,
                (1 * calcPn + this.timeSampler.pnBase) / 2,
            );
        }
    }

    computeTime(pn?: number) {
        if (this.perfNowBase < 0) return this.timeSampler.ctBase;
        return ((pn ?? performance.now()) - this.perfNowBase) * this.computedClockRate + this.computedClockBase;
    }
}
