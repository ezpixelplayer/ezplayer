import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import TabPanel from './TabPanel';
import { SyntheticEvent, useState, useEffect } from 'react';

export interface TabType {
    value: number;
    label: string;
    disabled?: boolean;
    component: JSX.Element;
}

export interface CustomTabsProp {
    children?: React.ReactNode;
    actionPanelWidth?: number;
    tabList: TabType[];
    activeTab?: number;
    handleTabChange?: (tabId: number) => void;
}

export const CustomTabs = ({ tabList, activeTab, actionPanelWidth = 0, handleTabChange, children }: CustomTabsProp) => {
    const [value, setValue] = useState(0);
    const [width, setWidth] = useState(100);
    const [childernWidth, setChildernWidth] = useState(0);

    useEffect(() => {
        if (activeTab) {
            setValue(activeTab);
        } else {
            setValue(0);
        }
    }, [activeTab]);

    useEffect(() => {
        if (actionPanelWidth) {
            setWidth(100 - actionPanelWidth);
            setChildernWidth(actionPanelWidth);
        } else {
            if (children) {
                setWidth(80);
                setChildernWidth(20);
            } else {
                setWidth(100);
                setChildernWidth(0);
            }
        }
    }, [actionPanelWidth]);

    const handleChange = (event: SyntheticEvent, newValue: number) => {
        setValue(newValue);
        if (handleTabChange) {
            handleTabChange(newValue);
        }
    };

    return (
        <>
            <Box className="customTabs mt-20">
                <Box className="flex-basic-space-between">
                    <Box sx={{ width: `${width}%` }}>
                        <Tabs value={value} variant="scrollable" scrollButtons="auto" onChange={handleChange}>
                            {tabList?.map((tab, index) => (
                                <Tab key={index} value={tab.value} label={tab.label} disabled={tab.disabled} />
                            ))}
                        </Tabs>
                    </Box>
                    <Box className="flex-basic-end" sx={{ width: `${childernWidth}%` }}>
                        {children && <>{children}</>}
                    </Box>
                </Box>
            </Box>
            <Box className="tabPanel">
                {tabList?.map((tabItem, idx) => (
                    <TabPanel key={idx} value={value} index={tabItem?.value || idx}>
                        <Box className="mt-10"> {tabItem.component}</Box>
                    </TabPanel>
                ))}
            </Box>
        </>
    );
};
